import type { WizardPrompter } from "openclaw/plugin-sdk/core";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { vi } from "vitest";

type ProgressSpin = {
  update: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

export function makePrompter(): { prompter: WizardPrompter; progressSpins: ProgressSpin[] } {
  const progressSpins: ProgressSpin[] = [];
  const progress = vi.fn((_label: string) => {
    const spin = { update: vi.fn(), stop: vi.fn() };
    progressSpins.push(spin);
    return spin;
  });

  const prompter: WizardPrompter = {
    intro: vi.fn(async (_title?: string) => undefined),
    outro: vi.fn(async (_message?: string) => undefined),
    note: vi.fn(async (_message: string, _title?: string) => undefined),
    select: vi.fn(async () => "") as WizardPrompter["select"],
    multiselect: vi.fn(async () => []) as WizardPrompter["multiselect"],
    text: vi.fn(async (_params: unknown) => "") as WizardPrompter["text"],
    confirm: vi.fn(async (_params: unknown) => true),
    progress,
  };

  return { prompter, progressSpins };
}

export function makeRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: ((code: number) => {
      throw new Error(`exit(${code})`);
    }) as RuntimeEnv["exit"],
  };
}

export function group(id: string, name: string) {
  return {
    id,
    name,
    description: "",
    image_url: null,
    creator_user_id: "user-1",
    created_at: 1,
    updated_at: 1,
    messages: {
      count: 0,
      last_message_created_at: 0,
      preview: {
        nickname: "",
        text: "",
      },
    },
  };
}
