/**
 * Wordmark now lives in the shared @85percent/brand package so the product app
 * and the marketing site (apps/landing-page) render one identical lockup. This
 * file is a thin re-export shim kept at the original path so existing
 * `@/components/ui/Wordmark` imports across apps/web keep working unchanged.
 * Edit the lockup in packages/brand/src/Wordmark.tsx.
 */
export { Wordmark } from '@85percent/brand'
