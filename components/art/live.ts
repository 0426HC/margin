"use client";

import { createContext, useContext } from "react";

/** True while the scene holding an illustration is on screen. Illustrations run their loops only then, so a resting page costs nothing. */
export const SceneLive = createContext(true);
export const useSceneLive = () => useContext(SceneLive);
