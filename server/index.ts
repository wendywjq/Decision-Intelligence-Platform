import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import express from "express";
import { resolve } from "node:path";
const app = createApp(openDatabase());
app.use(express.static(resolve("dist")));
app.listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log("Zeus API: http://127.0.0.1:3001"),
);
