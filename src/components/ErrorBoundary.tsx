import { Component, type ReactNode } from "react";
import { useT } from "../i18n";
import { resetParams } from "../store";

function Fallback({ error }: { error: Error }) {
  const t = useT();
  return (
    <div className="box err-text">
      <p>{t("This panel failed to render with these parameters.")}</p>
      <p className="small">{error.message}</p>
      <button className="small" onClick={resetParams}>{t("Reset parameters")}</button>
    </div>
  );
}

/** Keeps a render error in one tab from blanking the whole app. Give it a `key` that changes with the inputs to retry. */
/** resetKey: a change clears a caught error (a new design gets a fresh try) without remounting the children,
 *  so panel state (compare ghost, loaded measurement, running FDTD/synthesis) survives parameter edits. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error: Error | null; key?: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  render() { return this.state.error ? <Fallback error={this.state.error} /> : this.props.children; }
}
