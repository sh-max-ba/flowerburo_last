"use server"

import { revalidatePath } from "next/cache"
import { canCloseShift, canUseCash, requireRole, requireUser } from "@/lib/auth"
import {
  cancelOrder,
  cashIn,
  cashOut,
  changeUserPassword,
  closeShift,
  closeDeliveredOrder,
  completePickupOrder,
  createOrder,
  createSale,
  createUser,
  deleteProduct,
  handOrderToCourier,
  markOrderReady,
  openShift,
  replenishProductStock,
  setUserActive,
  startOrderWork,
  updateUser,
  upsertProduct,
  writeOffProductStock,
} from "@/lib/db"

type ActionResult = {
  ok: boolean
  message: string
  messages?: string[]
}

function getShiftId(formData: FormData) {
  return Number(String(formData.get("shiftId") ?? "").trim())
}

async function requireCashAccess() {
  const user = await requireUser()
  if (!(await canUseCash(user))) {
    throw new Error("Недостаточно прав для кассы.")
  }

  return user
}

async function runAction(
  action: () => void | string[] | boolean | { acceptedPayment: boolean; paidCourier: boolean },
  message: string
): Promise<ActionResult> {
  try {
    const result = action()
    revalidatePath("/")
    revalidatePath("/cash")
    revalidatePath("/orders")
    revalidatePath("/shifts")
    revalidatePath("/users")
    if (Array.isArray(result)) {
      return { ok: true, message: result[0] ?? message, messages: result }
    }
    if (typeof result === "boolean") {
      return {
        ok: true,
        message: result ? "Доплата принята" : message,
        messages: result ? ["Доплата принята", message] : [message],
      }
    }
    if (result && typeof result === "object") {
      const messages = [
        ...(result.acceptedPayment ? ["Доплата принята"] : []),
        ...(result.paidCourier ? ["Курьеру выдано из кассы"] : []),
        message,
      ]
      return { ok: true, message: messages[0] ?? message, messages }
    }
    return { ok: true, message, messages: [message] }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Операция не выполнена.",
    }
  }
}

export async function saveProductAction(formData: FormData) {
  await requireRole(["owner"])
  return runAction(() => upsertProduct(formData), "Товар сохранен.")
}

export async function deleteProductAction(code: string) {
  await requireRole(["owner"])
  return runAction(() => deleteProduct(code), "Товар удален.")
}

export async function replenishProductStockAction(formData: FormData) {
  await requireRole(["owner"])
  return runAction(() => replenishProductStock(formData), "Товар пополнен")
}

export async function writeOffProductStockAction(formData: FormData) {
  await requireRole(["owner"])
  return runAction(() => writeOffProductStock(formData), "Товар списан")
}

export async function createSaleAction(formData: FormData) {
  await requireCashAccess()
  return runAction(() => createSale(formData), "Продажа проведена.")
}

export async function openShiftAction(formData: FormData) {
  const user = await requireRole(["owner", "manager"])
  return runAction(() => openShift(formData, user), "Смена открыта.")
}

export async function closeShiftAction(formData: FormData) {
  const user = await requireUser()
  if (!canCloseShift(user, getShiftId(formData))) {
    return { ok: false, message: "Недостаточно прав для закрытия этой смены." }
  }

  return runAction(() => closeShift(formData, user), "Смена закрыта.")
}

export async function cashInAction(formData: FormData) {
  await requireCashAccess()
  return runAction(() => cashIn(formData), "Наличные внесены")
}

export async function cashOutAction(formData: FormData) {
  await requireCashAccess()
  return runAction(() => cashOut(formData), "Наличные изъяты")
}

export async function createOrderAction(formData: FormData) {
  await requireRole(["owner", "manager"])
  return runAction(() => createOrder(formData), "Заказ создан и отправлен флористам")
}

export async function startOrderWorkAction(orderId: number) {
  await requireRole(["owner", "manager", "florist"])
  return runAction(() => startOrderWork(orderId), "Заказ взят в работу")
}

export async function markOrderReadyAction(orderId: number) {
  await requireRole(["owner", "manager", "florist"])
  return runAction(() => markOrderReady(orderId), "Букет готов, склад списан")
}

export async function completePickupOrderAction(orderId: number, formData: FormData) {
  await requireCashAccess()
  return runAction(() => completePickupOrder(orderId, formData), "Заказ закрыт")
}

export async function handOrderToCourierAction(orderId: number, formData: FormData) {
  await requireCashAccess()
  return runAction(() => handOrderToCourier(orderId, formData), "Заказ передан курьеру")
}

export async function closeDeliveredOrderAction(orderId: number) {
  await requireCashAccess()
  return runAction(() => closeDeliveredOrder(orderId), "Заказ закрыт")
}

export async function cancelOrderAction(orderId: number) {
  await requireRole(["owner", "manager", "florist"])
  return runAction(
    () =>
      cancelOrder(orderId)
        ? ["Букет уже собран, склад автоматически не восстанавливается", "Заказ отменен"]
        : ["Заказ отменен"],
    "Заказ отменен"
  )
}

export async function createUserAction(formData: FormData) {
  await requireRole(["owner"])
  return runAction(() => createUser(formData), "Пользователь создан.")
}

export async function updateUserAction(formData: FormData) {
  await requireRole(["owner"])
  return runAction(() => updateUser(formData), "Пользователь сохранен.")
}

export async function changeUserPasswordAction(formData: FormData) {
  await requireRole(["owner"])
  return runAction(() => changeUserPassword(formData), "Пароль изменен.")
}

export async function setUserActiveAction(userId: number, isActive: boolean) {
  await requireRole(["owner"])
  return runAction(() => setUserActive(userId, isActive), isActive ? "Пользователь включен." : "Пользователь отключен.")
}
