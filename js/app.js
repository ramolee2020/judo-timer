import { loadStore, saveStore } from "./state.js";
import { initSetupView } from "./setup-view.js";
import { initRunView } from "./run-view.js";
import { unlockAudio } from "./audio.js";

const store = loadStore();

function showView(name) {
  document.body.dataset.view = name;
}

const runView = initRunView({
  onBackToSetup() {
    showView("setup");
    setupView.onShow();
  },
  onFinished() {
    showView("setup");
    setupView.onShow();
  },
});

const setupView = initSetupView({
  store,
  persistStore() {
    saveStore(store);
  },
  startTraining(params) {
    store.lastParams = { ...params };
    saveStore(store);
    unlockAudio();
    runView.start(params);
    showView("run");
  },
  continueRun(params) {
    store.lastParams = { ...params };
    saveStore(store);
    unlockAudio();
    runView.continueRun(params);
    showView("run");
  },
  discardRun() {
    runView.discard();
  },
  hasPausedRun: () => runView.hasActiveSession(),
  getActiveParams: () => runView.getActiveParams(),
});

if (runView.tryResumeFromSaved()) {
  showView("run");
} else {
  showView("setup");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
