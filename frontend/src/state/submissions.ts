import { create } from "zustand";

/** Lời báo đi theo người nộp từ form sang trang "Mẫu của tôi": tên của mẫu vừa được nhận. */
interface SubmissionsState {
  justSubmitted: string | null;
  setJustSubmitted(name: string | null): void;
}

export const useSubmissions = create<SubmissionsState>((set) => ({
  justSubmitted: null,
  setJustSubmitted: (justSubmitted) => set({ justSubmitted }),
}));
