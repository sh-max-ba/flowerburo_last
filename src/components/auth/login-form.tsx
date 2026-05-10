"use client"

import { useActionState } from "react"
import { LockKeyholeIcon } from "lucide-react"
import { loginAction, type LoginState } from "@/app/auth-actions"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const initialState: LoginState = {}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState)
  const hasError = Boolean(state.error)

  return (
    <Card className="w-full max-w-sm border bg-white">
      <CardHeader>
        <CardTitle>Вход</CardTitle>
        <CardDescription>Flower Ops</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action}>
          <FieldGroup>
            {hasError && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={hasError ? true : undefined}>
              <FieldLabel htmlFor="login">Логин</FieldLabel>
              <Input
                id="login"
                name="login"
                autoComplete="username"
                aria-invalid={hasError ? true : undefined}
                disabled={pending}
                required
              />
            </Field>
            <Field data-invalid={hasError ? true : undefined}>
              <FieldLabel htmlFor="password">Пароль</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={hasError ? true : undefined}
                disabled={pending}
                required
              />
              <FieldError>{state.error}</FieldError>
            </Field>
            <Button type="submit" disabled={pending} className="w-full">
              <LockKeyholeIcon data-icon="inline-start" />
              Войти
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
