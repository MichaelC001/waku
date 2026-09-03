import {
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetMethods,
} from '@expo/ui/community/bottom-sheet';
import type { ActivityFileChange, ActivityItem, AgentSession } from '@waku/client';
import {
  activityDisclosureSections,
  activityDisplayTitle,
  activityFileChangeStats,
  reasoningTitle,
} from '@waku/client/transcript-presentation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACTIVITY_ICONS } from './activity-icons';
import { AppSymbol } from './app-symbol';
import { DiffView } from './diff-view';
import { liquidGlass } from './glass-surface';
import { MonoFont, NativeTint, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { findActivity, type ActivityTarget } from '@/lib/session-presentation';
import { applyAlpha } from '@/md/color';
import { RowVeil, splitRunAtSpans } from '@/md/veil';

type OpenActivity = (target: ActivityTarget) => void;

const ActivitySheetContext = createContext<OpenActivity | null>(null);

function noop() {}

/** The opener for the activity detail sheet. Outside a host (tests) it is a
 * no-op, so rows never need to know whether a sheet is mounted. */
export function useActivitySheet(): OpenActivity {
  return useContext(ActivitySheetContext) ?? noop;
}

/** Whether the sheet would have anything to show for this activity — the
 * same test the sheet body applies, so a tappable card never opens empty. */
export function activityHasDetail(activity: ActivityItem): boolean {
  if (activity.reasoning) return activity.reasoning.content.trim().length > 0;
  return Boolean(
    activityDisclosureSections(activity).length
      || activity.file_changes?.length
      || activity.image_urls?.length,
  );
}

/** iOS gets the system medium/large detents. Android and web need explicit
 * snap points to offer a half-height state at all. */
const SNAP_POINTS = Platform.OS === 'ios' ? undefined : ['50%', '100%'];

/**
 * Activity details open in a native bottom sheet instead of expanding the
 * card in place: an inline disclosure inside the inverted, anchored
 * transcript has to fight the scroll position, while a sheet is the
 * platform's own idiom for "show me more about this row". One sheet serves
 * the whole transcript — a card hands it a locator, and the body re-resolves
 * that against the freshest session on every commit (each commit deep-clones
 * the session), so a running command's output keeps streaming into the
 * open sheet.
 */
export function ActivitySheetHost({
  session,
  children,
}: {
  session: AgentSession;
  children: ReactNode;
}) {
  const theme = useTheme();
  const sheet = useRef<BottomSheetMethods>(null);
  const [target, setTarget] = useState<ActivityTarget | null>(null);
  const open = useCallback<OpenActivity>((next) => setTarget(next), []);
  const activity = target ? findActivity(session, target) : null;

  useEffect(() => {
    if (target) sheet.current?.present();
  }, [target]);

  // A rewind can drop the turn the open activity belongs to; close rather
  // than leave an empty sheet up.
  useEffect(() => {
    if (target && !activity) sheet.current?.dismiss();
  }, [activity, target]);

  return (
    <ActivitySheetContext.Provider value={open}>
      {children}
      <BottomSheetModal
        ref={sheet}
        backgroundStyle={liquidGlass ? undefined : { backgroundColor: theme.surface }}
        enableDynamicSizing={false}
        enablePanDownToClose
        snapPoints={SNAP_POINTS}
        onDismiss={() => setTarget(null)}>
        <BottomSheetView style={styles.fill}>
          {activity ? <ActivityDetail activity={activity} /> : null}
        </BottomSheetView>
      </BottomSheetModal>
    </ActivitySheetContext.Provider>
  );
}

function ActivityDetail({ activity }: { activity: ActivityItem }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reasoning = activity.reasoning ? activity.reasoning.content.trim() : '';
  const sections = activity.reasoning ? [] : activityDisclosureSections(activity);
  const changes = activity.file_changes ?? [];
  const images = activity.image_urls ?? [];
  const title = activity.reasoning ? reasoningTitle(activity) : activityDisplayTitle(activity);
  return (
    <ScrollView
      alwaysBounceVertical={false}
      contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}
      style={styles.fill}>
      <View style={styles.header}>
        <View style={[styles.iconWell, { backgroundColor: theme.overlayStrong }]}>
          <AppSymbol
            name={ACTIVITY_ICONS[activity.kind]}
            size={17}
            tintColor={theme.textSecondary}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text
            accessibilityRole="header"
            numberOfLines={3}
            selectable
            style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
          <ActivityStatus activity={activity} />
        </View>
      </View>
      {activity.reasoning ? (
        <ReasoningText content={plainReasoning(reasoning)} live={!activity.complete} />
      ) : (
        <>
          {sections.map((section) => (
            <DetailSection
              content={section.content}
              key={section.kind}
              label={section.label}
              mono={section.kind !== 'detail'}
            />
          ))}
          {changes.map((change) => (
            <FileChange change={change} key={change.path} />
          ))}
          {images.map((url, index) => (
            <Image
              accessibilityIgnoresInvertColors
              key={index}
              resizeMode="contain"
              source={{ uri: url }}
              style={[styles.image, { backgroundColor: theme.inset }]}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}

/** Failure, progress, and edit totals under the title — each paired with a
 * word or glyph, never carried by color alone. */
function ActivityStatus({ activity }: { activity: ActivityItem }) {
  const theme = useTheme();
  if (activity.failed) {
    return (
      <View style={styles.status}>
        <AppSymbol
          name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
          size={12}
          tintColor={theme.danger}
        />
        <Text style={[styles.statusText, { color: theme.danger }]}>Failed</Text>
      </View>
    );
  }
  // A live thought already says "Thinking" in its title.
  if (!activity.complete && !activity.reasoning) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <View style={[styles.runningDot, { backgroundColor: NativeTint }]} />
        <Text style={[styles.statusText, { color: theme.textTertiary }]}>In progress</Text>
      </View>
    );
  }
  const stats = activityFileChangeStats(activity);
  if (stats) {
    return (
      <Text style={[styles.statusText, styles.stats]}>
        <Text style={{ color: theme.success }}>+{stats.additions}</Text>
        <Text style={{ color: theme.textGhost }}> </Text>
        <Text style={{ color: theme.danger }}>−{stats.deletions}</Text>
      </Text>
    );
  }
  return null;
}

function DetailSection({
  label,
  content,
  mono,
}: {
  label: string | null;
  content: string;
  mono: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      {label ? (
        <Text style={[styles.sectionLabel, { color: theme.textTertiary }]}>{label}</Text>
      ) : null}
      {content ? (
        mono ? (
          <View style={[styles.well, { backgroundColor: theme.inset, borderColor: theme.border }]}>
            <Text selectable style={[styles.monoText, { color: theme.textSecondary }]}>
              {boundedText(content)}
            </Text>
          </View>
        ) : (
          <Text selectable style={[styles.bodyText, { color: theme.textSecondary }]}>
            {boundedText(content)}
          </Text>
        )
      ) : null}
    </View>
  );
}

function FileChange({ change }: { change: ActivityFileChange }) {
  const theme = useTheme();
  const status = change.status ?? 'modified';
  const statusColor = status === 'added'
    ? theme.success
    : status === 'deleted'
      ? theme.danger
      : theme.warning;
  const statusWord = status === 'added' ? 'Added' : status === 'deleted' ? 'Deleted' : 'Modified';
  const diff = change.diff?.trim() ? change.diff : null;
  return (
    <View style={styles.fileChange}>
      <View accessible accessibilityLabel={`${statusWord} ${change.path}`} style={styles.fileRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text ellipsizeMode="head" numberOfLines={1} style={[styles.filePath, { color: theme.text }]}>
          {change.path}
        </Text>
        {(change.additions != null || change.deletions != null) && (
          <Text style={[styles.statusText, styles.stats]}>
            <Text style={{ color: theme.success }}>+{change.additions ?? 0}</Text>
            <Text style={{ color: theme.textGhost }}> </Text>
            <Text style={{ color: theme.danger }}>−{change.deletions ?? 0}</Text>
          </Text>
        )}
      </View>
      {diff ? <DiffView diff={diff} /> : null}
    </View>
  );
}

/** Streaming reasoning dissolves in like the desktop's strided reasoning
 * veil: appended text fades at half the message veil's tick rate, and text
 * present at mount is adopted at full opacity. */
function ReasoningText({ content, live }: { content: string; live: boolean }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const veil = useRef<RowVeil | null>(null);
  veil.current ??= new RowVeil(content.length > 0);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const spans = live && !reducedMotion ? veil.current.advance(0, content, Date.now()) : [];
  useEffect(() => {
    if (!spans.length) return;
    const timer = setTimeout(bump, 66);
    return () => clearTimeout(timer);
  });
  return (
    <Text selectable style={[styles.bodyText, { color: theme.textSecondary }]}>
      {splitRunAtSpans(0, content.length, spans).map(([start, end, opacity]) =>
        opacity >= 1 ? (
          content.slice(start, end)
        ) : (
          <Text key={start} style={{ color: applyAlpha(theme.textSecondary, opacity) }}>
            {content.slice(start, end)}
          </Text>
        ),
      )}
    </Text>
  );
}

function boundedText(value: string): string {
  const limit = 12_000;
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n… Output truncated`;
}

/** Reasoning is throwaway thinking: render it as quiet plain text, never
 * heavier than the answer. Strips the markdown emphasis and heading markers
 * providers put on their summary headlines. */
function plainReasoning(value: string): string {
  return boundedText(value)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: 14, paddingHorizontal: Spacing.three, paddingTop: 6 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  iconWell: {
    alignItems: 'center',
    borderRadius: Radius.small,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  headerCopy: { flex: 1, gap: 3, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  status: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  statusText: { fontSize: 13 },
  stats: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  runningDot: { borderRadius: 3, height: 6, width: 6 },
  section: { gap: 6 },
  sectionLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  well: {
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  monoText: { fontFamily: MonoFont, fontSize: 12, lineHeight: 17.5 },
  bodyText: { fontSize: 14.5, lineHeight: 21 },
  fileChange: { gap: 8 },
  fileRow: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 24 },
  statusDot: { borderRadius: 3, height: 6, width: 6 },
  filePath: { flex: 1, fontFamily: MonoFont, fontSize: 12 },
  image: { borderRadius: Radius.small, height: 240, width: '100%' },
});
