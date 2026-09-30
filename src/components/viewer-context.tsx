"use client"

import { createContext, useContext } from "react"

import type { UserRole } from "@/lib/db"

// Кто смотрит экран (роль) и как открыть окно смены — отдаёт оболочка CrmShell, чтобы вложенные
// компоненты не получали это пропсами через пять уровней.
export type Viewer = { id: number; name: string; role: UserRole }

const ViewerContext = createContext<Viewer | null>(null)
export const ViewerProvider = ViewerContext.Provider

export function useViewer() {
  return useContext(ViewerContext)
}

// Открыть окно «Открыть/Закрыть смену» (то же, что кнопка в чипе смены). null — на экране нет смены.
const ShiftActionContext = createContext<(() => void) | null>(null)
export const ShiftActionProvider = ShiftActionContext.Provider

export function useShiftAction() {
  return useContext(ShiftActionContext)
}
