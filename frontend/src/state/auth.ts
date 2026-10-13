import { create } from "zustand";

import { getMe, logIn, logOut, type User } from "../api";

/**
 * Ai đang dùng trang: `undefined` khi chưa hỏi xong server, `null` là khách, còn lại là tài khoản đang đăng nhập.
 * Phiên đăng nhập nằm trong một cookie mà JavaScript không đọc được; trang chỉ biết nó qua `GET /api/auth/session`.
 */
interface AuthState {
  user: User | null | undefined;
  /** Hỏi server xem cookie hiện có còn ứng với một phiên không. Gọi một lần khi trang mở. */
  refresh(): Promise<void>;
  /** Ném `ApiError` khi đăng nhập không thành; trang đăng nhập dịch mã lỗi thành lời. */
  logIn(email: string, password: string): Promise<void>;
  logOut(): Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: undefined,
  refresh: async () => {
    try {
      set({ user: await getMe() });
    } catch (error) {
      // Không hỏi được server thì coi như khách: mọi thứ để xem vẫn dùng được, và việc ghi sẽ tự báo lỗi.
      console.error(error);
      set({ user: null });
    }
  },
  logIn: async (email, password) => set({ user: await logIn(email, password) }),
  logOut: async () => {
    await logOut();
    set({ user: null });
  },
}));
