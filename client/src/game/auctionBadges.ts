import type { AuctionView } from '@blindtest/shared';
import type { PlayerBadge } from '../components/game/GameSidebar';
import type { I18nValue } from '../i18n/context';

/** Badges de la barre latérale : qui a annoncé, qui a la main, l'ordre de passage. */
export function auctionBadges(
  auction: AuctionView,
  playerIds: string[],
  t: I18nValue['t'],
): Record<string, PlayerBadge> {
  const badges: Record<string, PlayerBadge> = {};
  for (const id of playerIds) {
    if (!auction.participants.includes(id)) {
      badges[id] = { label: t('auction.badge.watch'), tone: 'wait' };
    } else if (auction.step === 'bidding') {
      badges[id] = auction.bidders.includes(id)
        ? { label: '✓', tone: 'ok' }
        : { label: t('auction.badge.waitingBid'), tone: 'wait' };
    } else {
      badges[id] = { label: t('auction.badge.watch'), tone: 'wait' };
    }
  }
  if (auction.step === 'bidding') return badges;
  auction.order.forEach((turn, position) => {
    const badge: PlayerBadge =
      turn.status === 'playing'
        ? { label: t('auction.badge.hand'), tone: 'hand' }
        : turn.status === 'found'
          ? { label: '✓', tone: 'ok' }
          : turn.status === 'wrong' || turn.status === 'silent'
            ? { label: '✗', tone: 'ko' }
            : turn.status === 'skipped'
              ? { label: t('auction.badge.skipped'), tone: 'wait' }
              : { label: t('auction.badge.rank', { n: position + 1 }), tone: 'wait' };
    badges[turn.playerId] = badge;
  });
  return badges;
}
