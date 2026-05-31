"use client"

import { useActionState, useState } from "react"
import { EyeIcon, EyeOffIcon, Flower2Icon, LockKeyholeIcon } from "lucide-react"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Input } from "@/components/ui/input"

const initialState: LoginState = {}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState)
  const [showPassword, setShowPassword] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)

  // Server error (wrong credentials) takes priority; client error covers the
  // empty-field slip before we even hit the server.
  const errorMessage = state.error ?? clientError
  const hasError = Boolean(errorMessage)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget)
    const login = String(formData.get("login") ?? "").trim()
    const password = String(formData.get("password") ?? "")
    if (!login || !password) {
      event.preventDefault()
      setClientError("Заполните логин и пароль")
      return
    }
    setClientError(null)
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="justify-items-center text-center">
        <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Flower2Icon className="size-6" />
        </div>
        <CardTitle className="text-2xl">Flower Buro</CardTitle>
        <CardDescription>Вход в систему магазина</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} onSubmit={handleSubmit}>
          <FieldGroup>
            {hasError && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={hasError ? true : undefined}>
              <FieldLabel htmlFor="login">Логин</FieldLabel>
              <Input
                id="login"
                name="login"
                autoComplete="username"
                autoFocus
                aria-invalid={hasError ? true : undefined}
                disabled={pending}
                onChange={() => clientError && setClientError(null)}
              />
            </Field>
            <Field data-invalid={hasError ? true : undefined}>
              <FieldLabel htmlFor="password">Пароль</FieldLabel>
              <InputGroup aria-invalid={hasError ? true : undefined}>
                <InputGroupInput
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  aria-invalid={hasError ? true : undefined}
                  disabled={pending}
                  onChange={() => clientError && setClientError(null)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={
                      showPassword ? "Скрыть пароль" : "Показать пароль"
                    }
                    aria-pressed={showPassword}
                    disabled={pending}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
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
