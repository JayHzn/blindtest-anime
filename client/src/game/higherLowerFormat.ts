/** Mise en forme du mode Plus ou moins (membres, écarts, choix), pour le jeu et les résultats. */
import type { HigherLowerCard, HigherLowerPick, RatioWindow } from '@blindtest/shared';
import type { I18nValue } from '../i18n/context';

type T = I18nValue['t'];
type Lang = I18nValue['lang'];

const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-US');

/** « 640 095 » (espaces fines en français). */
export const formatMembers = (n: number, lang: Lang): string => n.toLocaleString(locale(lang));

/** « 2,3 » ; « 3 » pour un nombre rond. */
export const formatRatio = (ratio: number, lang: Lang): string =>
  ratio.toLocaleString(locale(lang), { maximumFractionDigits: 1 });

/** Choix en toutes lettres : au tour 1, `higher` = « B est plus populaire ». */
export function pickLabel(tour: number, pick: HigherLowerPick, t: T): string {
  if (tour === 1) return t(pick === 'higher' ? 'hl.pick.bHigher' : 'hl.pick.aHigher');
  return t(pick === 'higher' ? 'hl.pick.higher' : 'hl.pick.lower');
}

/** Choix en un mot : « A » / « B » au tour 1, « Plus » / « Moins » ensuite. */
export function pickShort(tour: number, pick: HigherLowerPick, t: T): string {
  if (tour === 1) return pick === 'higher' ? 'B' : 'A';
  return t(pick === 'higher' ? 'hl.pick.short.higher' : 'hl.pick.short.lower');
}

/** « OP1 · « 99 » · MOB CHOIR · 2016 » */
export function cardMeta(card: HigherLowerCard): string {
  return [
    `${card.type}${card.sequence}`,
    card.song ? `« ${card.song} »` : null,
    card.artists,
    card.year,
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
}

/** « Écart minimum ×1,5 » ou « Écart entre ×1,3 et ×3 ». */
export function windowLabel(window: RatioWindow, t: T, lang: Lang): string {
  const min = formatRatio(window.min, lang);
  return window.max === null
    ? t('hl.window.min', { min })
    : t('hl.window.range', { min, max: formatRatio(window.max, lang) });
}
