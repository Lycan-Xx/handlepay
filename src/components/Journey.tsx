/**
 * The "where am I" strip shown on each guided flow: numbered stops, the ones
 * behind you ticked, the current one highlighted, and a line saying what to do
 * here. It only displays progress the page already knows.
 */
import { Icon } from "./Icon";

export function Journey(props: { label: string; steps: string[]; current: number; hint?: string }) {
  const { label, steps, current, hint } = props;
  return (
    <div className="journey" role="group" aria-label={label}>
      <p className="journey-kicker">
        {label} · Step {Math.min(current + 1, steps.length)} of {steps.length}
      </p>
      <div className={`rail ${steps.length > 5 ? "rail-long" : ""}`}>
        {steps.map((name, i) => (
          <div key={name} style={{ display: "contents" }}>
            {i > 0 && <div className={`rbar ${i <= current ? "ok" : ""}`} />}
            <div className={`rnode ${i < current ? "ok" : i === current ? "on" : ""}`} aria-current={i === current ? "step" : undefined}>
              <span className="rb">{i < current ? <Icon name="check" label="Done" /> : i + 1}</span>
              <span className="rl">{name}</span>
            </div>
          </div>
        ))}
      </div>
      {hint && <p className="journey-hint">{hint}</p>}
    </div>
  );
}
