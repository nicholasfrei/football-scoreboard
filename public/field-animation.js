export const ROUTE_DURATION_MS = 1100;
export const RETURN_DELAY_MS = 1000;
export const RETURN_DURATION_MS = 550;

/** Delay the football and blue scrimmage line, never the line to gain or game data. */
export function createBallPlacement({ render, schedule = setTimeout, cancel = clearTimeout }) {
  let pending = null;
  let lastAnimation = null;

  function reset() {
    if (pending) {
      cancel(pending.timer);
      pending.animation.element.removeEventListener("animationend", pending.finish);
      pending.animation.element.removeEventListener("animationcancel", pending.finish);
    }
    pending = null;
  }

  return {
    reset() { reset(); lastAnimation = null; },
    update({ key, game, startGame, animation, visible = true, reducedMotion = false }) {
      if (pending && pending.key === key && pending.animation.element === animation?.element
          && visible && !reducedMotion) {
        pending.game = game; // A fresh poll may correct the destination mid-animation.
        return;
      }
      reset();
      if (!visible || reducedMotion || !animation || animation.element === lastAnimation) {
        lastAnimation = animation?.element ?? null;
        render(game, { instant: true, hidden: !visible });
        return;
      }
      lastAnimation = animation.element;
      const next = { key, game, animation };
      next.finish = (event) => {
        if (pending !== next || (event && event.target !== animation.element)) return;
        const destination = next.game;
        reset();
        render(destination, { instant: true });
      };
      pending = next;
      render(startGame, { instant: true });
      animation.element.addEventListener("animationend", next.finish);
      animation.element.addEventListener("animationcancel", next.finish);
      // Safety net for removed elements or browsers that miss animation events.
      next.timer = schedule(next.finish, animation.durationMs + 100);
    },
  };
}
