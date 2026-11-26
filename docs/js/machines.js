/**
 * 狀態機定義（唯一來源）
 *
 * 畫面上「同一時間只能處在一種狀態」的東西都寫在這裡，app.js 只送事件（send），不自己改狀態字串。
 * 好處：
 *   - 使用者：不會出現「十字準星還在，畫面卻在看詳細資料」這種矛盾的畫面
 *   - 開發者：所有可能的狀態和轉換一眼看完；`npm run check` 會檢查打錯的事件名稱、走不到的狀態
 *   - 代理（Claude 等）：定義是純資料，可以直接讀、畫圖、檢查；目前狀態寫在 <body data-*> 和 window.__app.machines
 *
 * 格式是 XState v4 / @xstate/fsm 的設定格式（docs/vendor/xstate-fsm，MIT），可以貼到 stately.ai 的視覺化工具看圖。
 * 圖和完整清單見 STATE_MACHINES.md（由 scripts/machines.mjs 產生，check 會確認它是最新的）。
 *
 * 規則：
 *   - 狀態裡沒寫的事件就是「這時候不理會」，不是錯誤（例如選點時點到標記不會跳走）
 *   - entry / exit 的動作名稱必須在 app.js 的 actions 裡有實作，少了啟動時會在主控台報錯（測試會抓到）
 */
(function () {
  const MACHINES = {
    // 下方面板：收合、清單、地點詳細資料、回報選點
    sheet: {
      id: "sheet",
      initial: "peek",
      states: {
        peek: {
          on: { TOGGLE: "list", OPEN_LIST: "list", SHOW_DETAIL: "detail", START_PICK: "pick", LAYER_CHANGED: "peek" },
        },
        list: {
          on: { TOGGLE: "peek", CLOSE: "peek", MAP_TAP: "peek", BACK: "peek", SHOW_DETAIL: "detail", START_PICK: "pick", LAYER_CHANGED: "peek" },
        },
        detail: {
          entry: ["selectPlace"],
          exit: ["clearSelection"],
          on: { TOGGLE: "peek", CLOSE: "peek", MAP_TAP: "peek", BACK: "peek", SHOW_DETAIL: "detail", START_PICK: "pick", LAYER_CHANGED: "peek" },
        },
        // 選點時十字準星一定顯示，離開時一定收起（不論從哪個按鈕離開）。這時點到標記、拉面板都不理會，免得選到一半跳走
        pick: {
          entry: ["showTarget"],
          exit: ["hideTarget"],
          on: { CANCEL: "peek", BACK: "peek", CONFIRM: { target: "peek", actions: ["openReport"] }, LAYER_CHANGED: "peek" },
        },
      },
    },

    // 畫面範圍的地點資料：決定空清單要說「放大地圖」「載入中」「載入失敗」還是「真的沒有資料」（CLAUDE.md 規則 7）
    load: {
      id: "load",
      initial: "idle",
      states: {
        idle: { on: { FETCH: "loading", ZOOMED_OUT: "zoomedOut" } },
        zoomedOut: { on: { FETCH: "loading", ZOOMED_OUT: "zoomedOut" } },
        loading: {
          entry: ["startSlowHint"],
          exit: ["stopSlowHint"],
          on: { FETCH: "loading", LOADED: "ready", STALE: "stale", FAILED: "failed", TOO_WIDE: "tooWide", ZOOMED_OUT: "zoomedOut" },
        },
        ready: { on: { FETCH: "loading", ZOOMED_OUT: "zoomedOut" } },
        stale: { entry: ["hintStale"], on: { FETCH: "loading", ZOOMED_OUT: "zoomedOut" } },
        failed: { entry: ["hintFailed"], on: { FETCH: "loading", ZOOMED_OUT: "zoomedOut" } },
        tooWide: { on: { FETCH: "loading", ZOOMED_OUT: "zoomedOut" } },
      },
    },

    // 定位：找位置時再按一次不會重複要求；更新失敗時保留上一次的位置
    locate: {
      id: "locate",
      initial: "idle",
      states: {
        idle: { on: { LOCATE: "locating" } },
        locating: {
          entry: ["requestPosition"],
          on: { FOUND: "located", FAILED: [{ target: "located", cond: "hasPosition" }, { target: "idle" }] },
        },
        located: { on: { LOCATE: "locating" } },
      },
    },
  };

  /** 定義裡用到的動作與條件名稱（給啟動檢查和 scripts/check.mjs 用） */
  function namesIn(def) {
    const actions = new Set(), guards = new Set(), events = new Set(), targets = new Set();
    for (const s of Object.values(def.states)) {
      for (const a of [].concat(s.entry || [], s.exit || [])) actions.add(a);
      for (const [ev, t] of Object.entries(s.on || {})) {
        events.add(ev);
        for (const tr of [].concat(t)) {
          const o = typeof tr === "string" ? { target: tr } : tr;
          if (o.target) targets.add(o.target);
          for (const a of [].concat(o.actions || [])) actions.add(a);
          if (o.cond) guards.add(o.cond);
        }
      }
    }
    return { actions, guards, events, targets };
  }

  /**
   * 建立並啟動一個狀態機。
   * impl: { actions: { 名稱: (context, event) => {} }, guards: { 名稱: (context, event) => bool } }
   * 回傳 { send(type 或 {type,...}), can(type), get state(), subscribe(fn) }
   */
  function startMachine(id, impl = {}) {
    const FSM = window.XStateFSM;
    const def = MACHINES[id];
    const { actions, guards } = namesIn(def);
    const missing = [...actions].filter((a) => !(impl.actions || {})[a]).concat([...guards].filter((g) => !(impl.guards || {})[g]));
    if (missing.length) console.error(`[狀態機 ${id}] 這些動作或條件沒有實作：${missing.join("、")}`);
    // @xstate/fsm 的 cond 只能是函式：把名稱換成實作
    const resolved = JSON.parse(JSON.stringify(def));
    for (const s of Object.values(resolved.states)) {
      for (const [ev, t] of Object.entries(s.on || {})) {
        s.on[ev] = [].concat(t).map((tr) => (typeof tr === "object" && tr.cond ? { ...tr, cond: impl.guards[tr.cond] } : tr));
        if (!Array.isArray(t)) s.on[ev] = s.on[ev][0];
      }
    }
    const machine = FSM.createMachine(resolved, { actions: impl.actions || {} });
    const service = FSM.interpret(machine).start();
    return {
      id,
      send: (ev) => service.send(ev),
      can: (type) => !!(def.states[service.state.value].on || {})[type],
      get state() { return service.state.value; },
      subscribe: (fn) => service.subscribe((s) => fn(s.value, s)),
    };
  }

  window.MACHINES = MACHINES;
  window.machineNames = namesIn;
  window.startMachine = startMachine;
})();
