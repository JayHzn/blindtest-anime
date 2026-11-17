import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  normalize,
  pickingDurationMs,
  search,
  type PickedSong,
  type PlaylistSong,
  type TitleEntry,
} from '@blindtest/shared';
import { AppHeader } from '../components/AppHeader';
import { TimerBar } from '../components/game/TimerBar';
import { Button } from '../components/ui/Button';
import type { RoomSession } from '../game/RoomSession';
import { secondsLeft, useServerNow } from '../hooks/useServerNow';
import { useTitleIndex } from '../hooks/useTitleIndex';
import { useI18n } from '../i18n/context';
import { avatarColor } from '../lib/avatar';
import { PreviewPlayer } from '../lib/previewPlayer';
import styles from './Picking.module.css';

const MAX_SUGGESTIONS = 8;
/** Au-delà, un filtre texte aide à s'y retrouver dans la liste des chansons. */
const FILTER_FROM = 8;

interface PickingProps {
  session: RoomSession;
  onLeave: () => void;
}

type SongList =
  | { status: 'idle' }
  | { status: 'loading'; anime: TitleEntry }
  | { status: 'error'; anime: TitleEntry }
  | { status: 'ready'; anime: TitleEntry; songs: PlaylistSong[] };

const songLabel = (song: { type: string; sequence: number }) => `${song.type}${song.sequence}`;

/** Phase de choix du mode Playlist : chacun compose sa playlist en secret. */
export function Picking({ session, onLeave }: PickingProps) {
  const { t, lang } = useI18n();
  const { room } = useSyncExternalStore(session.subscribe, session.getState);
  const picking = room.picking;
  const now = useServerNow();
  const index = useTitleIndex();
  const [list, setList] = useState<SongList>({ status: 'idle' });
  const [busy, setBusy] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const player = useRef<PreviewPlayer | null>(null);

  useEffect(() => {
    const preview = new PreviewPlayer();
    preview.onChange = setPreviewing;
    player.current = preview;
    return () => preview.stop();
  }, []);

  if (!picking) return null;
  const mine = picking.mine;
  const full = mine.length >= picking.songsPerPlayer;
  const others = room.members.filter((member) => member.id !== room.you);
  const countOf = (id: string) => picking.progress.find((p) => p.playerId === id)?.count ?? 0;
  const allReady = room.members
    .filter((member) => member.connected)
    .every((member) => countOf(member.id) >= picking.songsPerPlayer);
  const seconds = secondsLeft(picking.endsAt, now);

  const openAnime = async (anime: TitleEntry) => {
    setList({ status: 'loading', anime });
    const songs = await session.songsFor(anime.id);
    setList((current) =>
      current.status === 'loading' && current.anime.id === anime.id
        ? songs
          ? { status: 'ready', anime, songs }
          : { status: 'error', anime }
        : current,
    );
  };

  const togglePreview = async (song: PlaylistSong) => {
    const preview = player.current;
    if (!preview) return;
    if (preview.playing === song.token) {
      preview.stop();
      return;
    }
    const target = await session.preview(song.token);
    if (target) preview.play(song.token, target.url, target.startRatio, session.currentVolume);
  };

  const choose = async (token: string) => {
    setBusy(token);
    await session.pick(token);
    setBusy(null);
  };

  const remove = async (token: string) => {
    setBusy(token);
    await session.unpick(token);
    setBusy(null);
  };

  const leave = () => {
    if (window.confirm(t('room.leave.confirm'))) onLeave();
  };

  return (
    <div className={styles.page}>
      <AppHeader
        center={
          <span className={styles.modePill}>
            {t('setup.mode.playlist')} · {t('picking.mode')}
          </span>
        }
      >
        <Button variant="secondary" onClick={leave}>
          {t('game.quit')}
        </Button>
      </AppHeader>

      <div className={styles.layout}>
        <main className={styles.main}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t('picking.title')}</h1>
            <span className={styles.clock} aria-live="off">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
            </span>
          </div>
          <TimerBar
            endsAt={picking.endsAt}
            durationMs={pickingDurationMs(picking.songsPerPlayer)}
          />

          {allReady ? (
            <p className={styles.allReady} role="status">
              {t('picking.allReady')}
            </p>
          ) : null}

          <AnimeSearch
            entries={index}
            onSelect={(anime) => void openAnime(anime)}
            placeholder={index ? t('picking.search.placeholder') : t('game.titlesLoading')}
          />

          {list.status !== 'idle' ? (
            <SongSection
              list={list}
              mine={mine}
              full={full}
              busy={busy}
              previewing={previewing}
              title={list.anime[lang]}
              onPreview={(song) => void togglePreview(song)}
              onChoose={(token) => void choose(token)}
              onRetry={() => void openAnime(list.anime)}
            />
          ) : null}

          <p className={styles.secret}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            {t('picking.secret')}
          </p>
        </main>

        <aside className={styles.aside}>
          <div className={styles.asideHeader}>
            <h2 className={styles.asideTitle}>{t('picking.mine')}</h2>
            <span className={styles.asideCount}>
              {mine.length}/{picking.songsPerPlayer}
            </span>
          </div>
          <ol className={styles.slots}>
            {Array.from({ length: picking.songsPerPlayer }, (_, i) => (
              <Slot
                key={mine[i]?.token ?? `empty-${i}`}
                n={i + 1}
                song={mine[i]}
                busy={busy}
                onRemove={(token) => void remove(token)}
              />
            ))}
          </ol>

          {others.length > 0 ? (
            <section className={styles.others}>
              <h3 className={styles.othersTitle}>{t('picking.others')}</h3>
              <ul className={styles.otherList}>
                {others.map((member) => {
                  const count = countOf(member.id);
                  const ready = count >= picking.songsPerPlayer;
                  return (
                    <li
                      key={member.id}
                      className={[styles.other, member.connected ? '' : styles.offline].join(' ')}
                    >
                      <span
                        className={styles.avatar}
                        style={{ background: avatarColor(member.id) }}
                        aria-hidden="true"
                      >
                        {member.pseudo.charAt(0).toUpperCase()}
                      </span>
                      <span className={styles.otherName}>{member.pseudo}</span>
                      <span className={ready ? styles.ready : styles.progress}>
                        {ready ? t('picking.ready') : `${count}/${picking.songsPerPlayer}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

interface AnimeSearchProps {
  entries: ReturnType<typeof useTitleIndex>;
  placeholder: string;
  onSelect: (anime: TitleEntry) => void;
}

/** Recherche d'anime (autocomplétion locale, comme pour les réponses). */
function AnimeSearch({ entries, placeholder, onSelect }: AnimeSearchProps) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();

  const suggestions = useMemo(() => {
    if (!entries || !text.trim()) return [];
    // Seuls les animes ont des chansons (pas les franchises).
    return search(entries, text, MAX_SUGGESTIONS * 2)
      .map((result) => result.entry)
      .filter((entry) => entry.k === 'a')
      .slice(0, MAX_SUGGESTIONS);
  }, [entries, text]);
  const showList = open && suggestions.length > 0;

  const select = (entry: TitleEntry | undefined) => {
    if (!entry) return;
    setText(entry[lang]);
    setOpen(false);
    onSelect(entry);
  };

  return (
    <div className={styles.search}>
      <input
        className={styles.searchInput}
        value={text}
        placeholder={placeholder}
        aria-label={t('picking.search.label')}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList ? `${listId}-${highlight}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setOpen(true);
            setHighlight((h) => (h + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (showList) select(suggestions[highlight]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <ul id={listId} role="listbox" className={styles.suggestions}>
          {suggestions.map((entry, i) => (
            <li
              key={entry.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={[styles.suggestion, i === highlight ? styles.highlighted : ''].join(' ')}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(entry)}
            >
              {entry[lang]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface SongSectionProps {
  list: Exclude<SongList, { status: 'idle' }>;
  title: string;
  mine: PickedSong[];
  full: boolean;
  busy: string | null;
  previewing: string | null;
  onPreview: (song: PlaylistSong) => void;
  onChoose: (token: string) => void;
  onRetry: () => void;
}

function SongSection({
  list,
  title,
  mine,
  full,
  busy,
  previewing,
  onPreview,
  onChoose,
  onRetry,
}: SongSectionProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const songs = list.status === 'ready' ? list.songs : [];
  const query = normalize(filter);
  const shown = query
    ? songs.filter((song) =>
        normalize(`${songLabel(song)} ${song.song ?? ''} ${song.artists ?? ''}`).includes(query),
      )
    : songs;

  return (
    <section className={styles.songs}>
      <div className={styles.songsHeader}>
        <h2 className={styles.songsTitle}>{t('picking.songsOf', { title })}</h2>
        {list.status === 'ready' ? (
          <span className={styles.songCount}>
            {songs.length === 1
              ? t('picking.songCount.one')
              : t('picking.songCount', { n: songs.length })}
          </span>
        ) : null}
      </div>

      {list.status === 'loading' ? <p className={styles.muted}>{t('picking.loading')}</p> : null}
      {list.status === 'error' ? (
        <p className={styles.muted}>
          {t('picking.error')}{' '}
          <button type="button" className={styles.link} onClick={onRetry}>
            {t('server.retry')}
          </button>
        </p>
      ) : null}
      {list.status === 'ready' && songs.length === 0 ? (
        <p className={styles.muted}>{t('picking.noSongs')}</p>
      ) : null}

      {songs.length > FILTER_FROM ? (
        <input
          className={styles.filter}
          value={filter}
          placeholder={t('picking.filter')}
          aria-label={t('picking.filter')}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}

      <ul className={styles.songList}>
        {shown.map((song) => {
          const chosen = mine.some((picked) => picked.token === song.token);
          const playing = previewing === song.token;
          return (
            <li
              key={song.token}
              className={[styles.song, playing ? styles.songPlaying : ''].join(' ')}
            >
              <span className={styles.songBadge}>{songLabel(song)}</span>
              <span className={styles.songText}>
                <span className={styles.songName}>
                  {song.song ? `« ${song.song} »` : t('picking.unknownSong')}
                  {song.artists ? (
                    <span className={styles.songArtists}> — {song.artists}</span>
                  ) : null}
                </span>
                {playing ? <span key={song.token} className={styles.previewBar} /> : null}
              </span>
              <button
                type="button"
                className={[styles.previewButton, playing ? styles.previewActive : ''].join(' ')}
                aria-label={playing ? t('picking.stopPreview') : t('picking.preview')}
                title={playing ? t('picking.stopPreview') : t('picking.preview')}
                onClick={() => onPreview(song)}
              >
                {playing ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7 4.5v15l13-7.5z" />
                  </svg>
                )}
              </button>
              <Button
                variant={chosen ? 'secondary' : 'primary'}
                disabled={chosen || full || busy === song.token}
                title={full && !chosen ? t('picking.full') : undefined}
                onClick={() => onChoose(song.token)}
              >
                {chosen ? t('picking.chosen') : t('picking.choose')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface SlotProps {
  n: number;
  song: PickedSong | undefined;
  busy: string | null;
  onRemove: (token: string) => void;
}

function Slot({ n, song, busy, onRemove }: SlotProps) {
  const { t, lang } = useI18n();
  if (!song) {
    return (
      <li className={[styles.slot, styles.slotEmpty].join(' ')}>
        <span className={styles.slotNumber}>{n}</span>
        <span className={styles.slotText}>
          <span className={styles.slotTitle}>{t('picking.empty')}</span>
          <span className={styles.slotSong}>{t('picking.emptyHint')}</span>
        </span>
      </li>
    );
  }
  const title = song.anime[lang];
  return (
    <li className={styles.slot}>
      <span className={styles.slotNumber}>{n}</span>
      <span className={styles.slotText}>
        <span className={styles.slotTitle}>{title}</span>
        <span className={styles.slotSong}>
          {songLabel(song)}
          {song.song ? ` « ${song.song} »` : ''}
        </span>
      </span>
      <button
        type="button"
        className={styles.remove}
        aria-label={t('picking.remove', { title })}
        title={t('picking.remove', { title })}
        disabled={busy === song.token}
        onClick={() => onRemove(song.token)}
      >
        ×
      </button>
    </li>
  );
}
