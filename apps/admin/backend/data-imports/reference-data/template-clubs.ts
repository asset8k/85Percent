/**
 * Canonical 44-club onboarding catalog (2026-27 season): 20 Premier League +
 * 24 Championship. This is the single source of truth for which template
 * clubs onboarding offers — it is what `pnpm db:seed:templates:*` upserts
 * into `template_clubs`, and what a fresh Supabase project needs to
 * reproduce the catalog without any manual SQL.
 *
 * `id` is the canonical, stable template-club id (sourced from Development,
 * the only environment that has run Data Sync since the catalog existed). It
 * seeds brand-new rows on a fresh database; it is NEVER used to overwrite the
 * id of a row that already exists under the same `name` — see
 * `template-catalog.ts`'s upsert-by-name logic. `footballDataClubId` is the
 * football-data.org club id (provider mapping), used by the live league-table
 * sync and Data Sync's standings import; it has 100% coverage across all 44
 * clubs, unlike the Transfermarkt club mapping, which Data Sync only creates
 * once a squad import actually runs for that club (so it does not belong in a
 * static catalog).
 *
 * Adding/removing a club (promotion, relegation): edit this array, then run
 * `pnpm db:seed:templates:dev` and `pnpm db:seed:templates:prod`. Clubs
 * removed from this list are NOT deleted from the database — flip them out
 * by leaving them off `ACTIVE`; historical rows, roster snapshots, and import
 * history stay intact so relegated clubs can return without re-import.
 */

export type TemplateLeagueCode = 'PREMIER_LEAGUE' | 'CHAMPIONSHIP'

export interface CanonicalTemplateClub {
  /** Stable template-club id. Used only when inserting a brand-new row. */
  id: string
  /** Exact, DB-unique business key (`template_clubs.name`) — the real upsert key. */
  name: string
  league: TemplateLeagueCode
  logoUrl: string
  /** football-data.org club id — required, used by GET /league-table and standings sync. */
  footballDataClubId: string
}

export const TEMPLATE_CLUB_CATALOG: readonly CanonicalTemplateClub[] = [
  { id: 'fb63cc87-f698-490a-8470-c756af2f9d21', name: 'Birmingham City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/337.png', footballDataClubId: '332' },
  { id: 'f864433f-3ce4-4492-9bc1-30dd2047d0db', name: 'Blackburn Rovers', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/164.png', footballDataClubId: '59' },
  { id: '23076a4d-3560-4563-8234-4f5250bf4349', name: 'Bolton Wanderers', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/355.png', footballDataClubId: '60' },
  { id: 'a36408c4-ea94-4924-bdea-dd30e8c56f31', name: 'Bristol City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/698.png', footballDataClubId: '387' },
  { id: '39936860-89be-4f5e-b01d-3221cae4cc4d', name: 'Burnley FC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1132.png', footballDataClubId: '328' },
  { id: 'b69d9f78-19b5-4397-85c0-ff3e80f80ea9', name: 'Cardiff City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/603.png', footballDataClubId: '715' },
  { id: 'ef19b051-edd7-40c1-917e-ca33165784c3', name: 'Charlton Athletic', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/358.png', footballDataClubId: '348' },
  { id: '20d12146-6415-4044-abf4-f9661a25f6a4', name: 'Derby County', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/22.png', footballDataClubId: '342' },
  { id: '1ee73364-1b1f-4ccc-9cf2-e4bce3291e8e', name: 'Lincoln City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1198.png', footballDataClubId: '1126' },
  { id: '4e847635-2aec-4bab-9844-247743a0a938', name: 'Middlesbrough FC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/641.png', footballDataClubId: '343' },
  { id: '1e655394-c2e9-4bc0-b561-15cb635de6b8', name: 'Millwall FC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1028.png', footballDataClubId: '384' },
  { id: 'a58e7e37-6ef8-4a35-8209-270388cfd30f', name: 'Norwich City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1123.png', footballDataClubId: '68' },
  { id: '7e42f81a-5384-459e-b57b-ceed87e238b2', name: 'Portsmouth FC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1020.png', footballDataClubId: '325' },
  { id: 'f2217856-8d71-4423-817f-9f8633b3e882', name: 'Preston North End', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/466.png', footballDataClubId: '1081' },
  { id: 'd1e3b303-d617-4b14-abea-e6a39e7eaf80', name: 'Queens Park Rangers', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1039.png', footballDataClubId: '69' },
  { id: 'b83895c0-33b2-41c5-9193-25f225537515', name: 'Sheffield United', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/350.png', footballDataClubId: '356' },
  { id: '7ec41eb9-9a00-4b8d-aaf7-88444b31cd81', name: 'Southampton FC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/180.png', footballDataClubId: '340' },
  { id: 'b9ad95f6-0996-40ec-b7ed-4a56594bdca5', name: 'Stoke City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/512.png', footballDataClubId: '70' },
  { id: '3836270e-f1ae-490f-9f52-b85bf67a7110', name: 'Swansea City', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/2288.png', footballDataClubId: '72' },
  { id: '9244a867-fddd-42c0-881a-a9120fbdd18c', name: 'Watford FC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1010.png', footballDataClubId: '346' },
  { id: '9ded409f-4b43-40a4-909e-45033b265b5f', name: 'West Bromwich Albion', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/984.png', footballDataClubId: '74' },
  { id: '41c216da-bcf1-4576-9518-c07e00ae917b', name: 'West Ham United', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/379.png', footballDataClubId: '563' },
  { id: '54e107dd-6d44-4b55-b083-07893d490ff7', name: 'Wolverhampton Wanderers', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/543.png', footballDataClubId: '76' },
  { id: '2c3c9122-5569-42ba-a2ab-da633f8c26ae', name: 'Wrexham AFC', league: 'CHAMPIONSHIP', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1112.png', footballDataClubId: '404' },
  { id: '0703ddc6-5a90-4656-92bf-68ee224b5c57', name: 'AFC Bournemouth', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/989.png', footballDataClubId: '1044' },
  { id: '1318595a-4565-4cca-9c74-5ad9b158a922', name: 'Arsenal FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/11.png', footballDataClubId: '57' },
  { id: 'bb53999a-cf75-46c5-b691-5dd0a5fd3c20', name: 'Aston Villa', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/405.png', footballDataClubId: '58' },
  { id: '3ef6e92d-d522-47b2-8bfc-475444c75e02', name: 'Brentford FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1148.png', footballDataClubId: '402' },
  { id: '2fc299db-3bdd-4f16-ba7d-d78b9543e1c3', name: 'Brighton & Hove Albion', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/1237.png', footballDataClubId: '397' },
  { id: 'f22e6194-10e6-48c5-ab83-dc942019a2ae', name: 'Chelsea FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/631.png', footballDataClubId: '61' },
  { id: 'a3e69deb-f863-4143-9358-34ea9a1592a8', name: 'Coventry City', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/990.png', footballDataClubId: '1076' },
  { id: '5d471591-3e6e-422a-9d03-98ed92c040eb', name: 'Crystal Palace', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/873.png', footballDataClubId: '354' },
  { id: 'ef04b0f5-dcf6-44ba-a8d4-76581416e7c3', name: 'Everton FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/29.png', footballDataClubId: '62' },
  { id: '2d1e60f4-b32c-43b0-98ae-b8177f5113ca', name: 'Fulham FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/931.png', footballDataClubId: '63' },
  { id: '026c537a-8511-479d-9329-029b1e66af77', name: 'Hull City', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/3008.png', footballDataClubId: '322' },
  { id: '9cbe8903-d73e-47d1-96f8-53cf8751f470', name: 'Ipswich Town', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/677.png', footballDataClubId: '349' },
  { id: '50efb7fe-f1b2-4987-8cf8-f7dd6d33532e', name: 'Leeds United', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/399.png', footballDataClubId: '341' },
  { id: '916aae1f-cd72-442c-8b60-595adbed4471', name: 'Liverpool FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/31.png', footballDataClubId: '64' },
  { id: '7be73d3e-5ecb-4e46-b349-e9daba4658bc', name: 'Manchester City', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/281.png', footballDataClubId: '65' },
  { id: '72fd1ed1-93d5-44be-b8cd-f3b180ac917d', name: 'Manchester United', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/985.png', footballDataClubId: '66' },
  { id: 'a7480ebd-ca34-4f9c-8a59-28ea161dea99', name: 'Newcastle United', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/762.png', footballDataClubId: '67' },
  { id: '154e54cf-9ad1-4148-b1ce-a7127b109682', name: 'Nottingham Forest', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/703.png', footballDataClubId: '351' },
  { id: '602793f2-55dc-4d41-8714-9f9280e0a3f2', name: 'Sunderland AFC', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/289.png', footballDataClubId: '71' },
  { id: '05480580-0187-47d5-8a26-0378c2cb2a8a', name: 'Tottenham Hotspur', league: 'PREMIER_LEAGUE', logoUrl: 'https://tmssl.akamaized.net//images/wappen/big/148.png', footballDataClubId: '73' },
] as const
