"use client";
import * as React from "react";
import { Slot, Tabs as PrimitiveTabs } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

const variants = cva("dk-button", { variants: { variant: { primary: "dk-button-primary", secondary: "dk-button-secondary", ghost: "dk-button-ghost", danger: "dk-button-danger" } }, defaultVariants: { variant: "primary" } });
export function Button({ className, variant, asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={clsx(variants({ variant }), className)} {...props} />;
}
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <section className={clsx("dk-card", className)} {...props} />; }
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) { return <input className={clsx("dk-input", className)} {...props} />; }
export const Tabs = PrimitiveTabs.Root;
export const TabsList = PrimitiveTabs.List;
export const TabsTrigger = PrimitiveTabs.Trigger;
export const TabsContent = PrimitiveTabs.Content;
