import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export const BillingPage = () => {
  const [message, setMessage] = useState("");

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Card details must go through a payment provider once billing is connected.
    setMessage("Your card was not saved. Billing is not connected yet.");
  };

  return (
    <main className="h-full overflow-auto px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-muted-foreground">Settings</p>
          <h1 className="font-semibold text-2xl tracking-tight">Billing</h1>
          <p className="text-muted-foreground">Manage your payment details.</p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Payment method</h2>
            </CardTitle>
            <CardDescription>Enter the details on your card.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onChange={() => setMessage("")} onSubmit={save}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="card-name">Card name</FieldLabel>
                  <Input
                    autoComplete="cc-name"
                    id="card-name"
                    name="cardName"
                    pattern=".*\\S.*"
                    placeholder="Name on card"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="card-number">Card number</FieldLabel>
                  <Input
                    aria-describedby="card-number-description"
                    autoComplete="cc-number"
                    id="card-number"
                    inputMode="numeric"
                    maxLength={23}
                    name="cardNumber"
                    pattern="(?:[0-9] ?){12,18}[0-9]"
                    placeholder="1234 5678 9012 3456"
                    required
                    type="text"
                  />
                  <FieldDescription id="card-number-description">
                    Enter 13 to 19 digits, with or without spaces.
                  </FieldDescription>
                </Field>
                <div className="flex justify-end border-t pt-4">
                  <Button type="submit">Save</Button>
                </div>
                <p
                  aria-live="polite"
                  className="text-muted-foreground"
                  role="status"
                >
                  {message}
                </p>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
};
