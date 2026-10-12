"use client";

import { createContext, useContext } from "react";

export type Me = { id: number; email: string; is_admin: boolean };

export const MeContext = createContext<Me | null>(null);

export const useMe = () => useContext(MeContext);
