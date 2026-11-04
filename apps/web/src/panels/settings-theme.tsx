/** The editor's theme, in Settings › Preferences: the person's, kept in the browser. */
import { OptionSelect } from "../components/option-select.tsx";
import { type ThemePreference, useTheme } from "../state/theme.ts";
import { Row, rowSelect } from "./settings-group.tsx";

const themes = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export const ThemeRow = () => {
  const preference = useTheme((s) => s.preference);
  return (
    <Row description="Designs keep their own themes." title="Theme">
      <OptionSelect
        className={rowSelect}
        onChange={(v) => useTheme.getState().set(v as ThemePreference)}
        options={themes}
        value={preference}
      />
    </Row>
  );
};
