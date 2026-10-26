/**
 * The welcome page's script: the project list through the Platform bridge the preload script
 * sets, and the reason the last project could not be opened, when there is one.
 */

interface WelcomeProject {
  readonly detail?: string;
  readonly id: string;
  readonly name: string;
}

interface Bridge {
  readonly projects?: {
    readonly add?: () => Promise<void>;
    readonly list: () => Promise<readonly WelcomeProject[]>;
    readonly open: (id: string) => Promise<void>;
  };
}

const bridge = (globalThis as { ultrapaintPlatform?: Bridge })
  .ultrapaintPlatform;
const projects = bridge?.projects;

const problem = new URLSearchParams(location.search).get("problem");
const problemBox = document.getElementById("problem");
if (problem && problemBox) {
  problemBox.textContent = problem;
  problemBox.hidden = false;
}

const say = (error: unknown) => {
  if (problemBox) {
    problemBox.textContent =
      error instanceof Error ? error.message : String(error);
    problemBox.hidden = false;
  }
};

document.getElementById("add")?.addEventListener("click", () => {
  projects?.add?.().catch(say);
});

/** One project of the list, which opens it. */
const entry = (project: WelcomeProject) => {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = project.name;
  if (project.detail) {
    const detail = document.createElement("small");
    detail.textContent = project.detail;
    button.append(detail);
  }
  button.addEventListener("click", () => {
    projects?.open(project.id).catch(say);
  });
  item.append(button);
  return item;
};

const show = async () => {
  const all = (await projects?.list()) ?? [];
  document.getElementById("projects")?.append(...all.map(entry));
};

show().catch(say);
