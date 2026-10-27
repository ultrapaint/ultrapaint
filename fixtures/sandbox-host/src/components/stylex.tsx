/**
 * A component styled with StyleX as it develops: its Babel plugin injects the rules at run time,
 * one by one, into a `<style>` of the head (docs/PLAN-preview-sandbox.md, step 12).
 */
import { create, props } from "@stylexjs/stylex";

const styles = create({
  box: {
    backgroundColor: "rgb(0, 160, 0)",
    borderStyle: { "@media (max-width: 500px)": "dashed", default: "none" },
    height: 40,
    width: 40,
  },
});

export function StylexProbe() {
  return (
    <div style={{ padding: 16 }}>
      <div {...props(styles.box)} data-probe="stylex" />
    </div>
  );
}
