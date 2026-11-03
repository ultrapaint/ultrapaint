/** The editor's theme, in Settings › Editor: the person's, kept in the browser. */
import { OptionSelect } from "../components/option-select.tsx";
import { type ThemePreference, useTheme } from "../state/theme.ts";
import { Group, Row } from "./settings-group.tsx";

const themes = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export const ThemeGroup = () => {
  const preference = useTheme((s) => s.preference);
  return (
    <Group title="Appearance">
      <Row
        description="The editor's own colours. Designs keep their themes."
        title="Theme"
      >
        <OptionSelect
          onChange={(v) => useTheme.getState().set(v as ThemePreference)}
          options={themes}
          value={preference}
        />
      </Row>
    </Group>
  );
};
