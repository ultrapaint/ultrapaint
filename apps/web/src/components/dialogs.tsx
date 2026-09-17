import {
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  useCallback,
  useState,
} from "react";
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
  confirmLabel?: string;
  description?: string;
  destructive?: boolean;
  title: string;
}

interface PromptOptions {
  confirmLabel?: string;
  defaultValue?: string;
  description?: string;
  placeholder?: string;
  title: string;
}

type Request =
  | ({
      kind: "confirm";
      id: number;
      resolve: (ok: boolean) => void;
    } & ConfirmOptions)
  | ({
      kind: "prompt";
      id: number;
      resolve: (value: string | null) => void;
    } & PromptOptions);

let nextId = 0;

const takeId = () => {
  const id = nextId;
  nextId += 1;
  return id;
};

// `open` is tracked apart from `request` so the content stays mounted while the exit animation runs.
const useDialogs = create<{ request: Request | null; open: boolean }>(() => ({
  open: false,
  request: null,
}));

/** Promise-based replacement for `window.confirm`, rendered by `<DialogHost />`. */
export const confirmDialog = (options: ConfirmOptions) =>
  new Promise<boolean>((resolve) =>
    useDialogs.setState({
      open: true,
      request: { id: takeId(), kind: "confirm", resolve, ...options },
    })
  );

/** Promise-based replacement for `window.prompt`; resolves to null when dismissed. */
export const promptDialog = (options: PromptOptions) =>
  new Promise<string | null>((resolve) =>
    useDialogs.setState({
      open: true,
      request: { id: takeId(), kind: "prompt", resolve, ...options },
    })
  );

const settleConfirm = (ok: boolean) => {
  const { open, request } = useDialogs.getState();
  if (!open) {
    return;
  }
  useDialogs.setState({ open: false });
  if (request?.kind === "confirm") {
    request.resolve(ok);
  }
};
const settlePrompt = (value: string | null) => {
  const { open, request } = useDialogs.getState();
  if (!open) {
    return;
  }
  useDialogs.setState({ open: false });
  if (request?.kind === "prompt") {
    request.resolve(value);
  }
};

const onConfirmOpenChange = (o: boolean) => {
  if (!o) {
    settleConfirm(false);
  }
};
const onPromptOpenChange = (o: boolean) => {
  if (!o) {
    settlePrompt(null);
  }
};
const acceptConfirm = () => settleConfirm(true);
const selectOnFocus = (e: FocusEvent<HTMLInputElement>) => e.target.select();

export const DialogHost = () => {
  const request = useDialogs((s) => s.request);
  const open = useDialogs((s) => s.open);
  const confirm = request?.kind === "confirm" ? request : null;
  const prompt = request?.kind === "prompt" ? request : null;

  return (
    <>
      <AlertDialog onOpenChange={onConfirmOpenChange} open={open && !!confirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            {confirm?.description ? (
              <AlertDialogDescription>
                {confirm.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={acceptConfirm}
              variant={confirm?.destructive ? "destructive" : "default"}
            >
              {confirm?.confirmLabel ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog onOpenChange={onPromptOpenChange} open={open && !!prompt}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          {prompt ? (
            <PromptForm
              key={prompt.id}
              onSettle={settlePrompt}
              request={prompt}
            />
          ) : null}
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
  const [value, setValue] = useState(request.defaultValue ?? "");
  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      onSettle(value.trim() === "" ? null : value);
    },
    [onSettle, value]
  );
  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
    []
  );
  const onCancel = useCallback(() => onSettle(null), [onSettle]);
  return (
    <form className="contents" onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description ? (
          <DialogDescription>{request.description}</DialogDescription>
        ) : null}
      </DialogHeader>
      <Input
        autoFocus
        onChange={onChange}
        onFocus={selectOnFocus}
        placeholder={request.placeholder}
        value={value}
      />
      <DialogFooter>
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button type="submit">{request.confirmLabel ?? "Apply"}</Button>
      </DialogFooter>
    </form>
  );
};
