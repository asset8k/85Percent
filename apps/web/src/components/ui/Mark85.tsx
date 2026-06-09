/**
 * Mark85 now lives in the shared @85percent/brand package so the product app and
 * the marketing site (apps/landing-page) render one identical mark. This file is
 * a thin re-export shim kept at the original path so existing `@/components/ui/Mark85`
 * imports across apps/web keep working unchanged. Edit the mark in
 * packages/brand/src/Mark85.tsx (ported from design/Logo/mark85.js).
 */
export { Mark85 } from '@85percent/brand'
