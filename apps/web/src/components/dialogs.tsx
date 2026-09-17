import * as React from "react";
import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

type Request =
  | ({ kind: "confirm"; id: number; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: "prompt"; id: number; resolve: (value: string | null) => void } & PromptOptions);

let nextId = 0;

// `open` is tracked apart from `request` so the content stays mounted while the exit animation runs.
const useDialogs = create<{ request: Request | null; open: boolean }>(() => ({
  request: null,
  open: false,
}));

/** Promise-based replacement for `window.confirm`, rendered by `<DialogHost />`. */
export const confirmDialog = (options: ConfirmOptions) =>
  new Promise<boolean>((resolve) =>
    useDialogs.setState({
      request: { kind: "confirm", id: nextId++, resolve, ...options },
      open: true,
    }),
  );

/** Promise-based replacement for `window.prompt`; resolves to null when dismissed. */
export const promptDialog = (options: PromptOptions) =>
  new Promise<string | null>((resolve) =>
    useDialogs.setState({
      request: { kind: "prompt", id: nextId++, resolve, ...options },
      open: true,
    }),
  );

export const DialogHost = () => {
  const request = useDialogs((s) => s.request);
  const open = useDialogs((s) => s.open);
  const confirm = request?.kind === "confirm" ? request : null;
  const prompt = request?.kind === "prompt" ? request : null;

  const settleConfirm = (ok: boolean) => {
    if (!open) return;
    useDialogs.setState({ open: false });
    confirm?.resolve(ok);
  };
  const settlePrompt = (value: string | null) => {
    if (!open) return;
    useDialogs.setState({ open: false });
    prompt?.resolve(value);
  };

  return (
    <>
      <AlertDialog open={open && !!confirm} onOpenChange={(o) => !o && settleConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            {confirm?.description && (
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm?.destructive ? "destructive" : "default"}
              onClick={() => settleConfirm(true)}
            >
              {confirm?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={open && !!prompt} onOpenChange={(o) => !o && settlePrompt(null)}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          {prompt && <PromptForm key={prompt.id} request={prompt} onSettle={settlePrompt} />}
        </DialogContent>
      </Dialog>
    </>
  );
};

const PromptForm = ({
  request,
  onSettle,
}: {
  request: PromptOptions;
  onSettle: (value: string | null) => void;
}) => {
  const [value, setValue] = React.useState(request.defaultValue ?? "");
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        onSettle(value.trim() === "" ? null : value);
      }}
    >
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description && <DialogDescription>{request.description}</DialogDescription>}
      </DialogHeader>
      <Input
        autoFocus
        value={value}
        placeholder={request.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onSettle(null)}>
          Cancel
        </Button>
        <Button type="submit">{request.confirmLabel ?? "Apply"}</Button>
      </DialogFooter>
    </form>
  );
};
