'use client'
// ── Holostaff instrumentation ──────────────────────────────────
// Created by the Holostaff deploy agent (deploy v2).
// Client-side stage marker for App Router server-component pages
// (useEffect cannot run in server components). Rendered by entry
// pages; safe to move together with its imports. https://docs.holostaff.ai
import { useEffect } from 'react'
import { holostaff } from '@holostaff/sdk'

export function HolostaffStageMark({ stage }: { stage: string }) {
  useEffect(() => {
    holostaff.markStageEntry(stage as Parameters<typeof holostaff.markStageEntry>[0])
  }, [stage])
  return null
}
