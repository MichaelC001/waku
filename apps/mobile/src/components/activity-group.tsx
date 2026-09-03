import type { ActivityItem, TranscriptBlock } from '@waku/client';
import { activitiesForBlock } from '@waku/client/event-reducer';
import {
  activityActionLabel,
  activityFileChangeStats,
  activityHeaderTitle,
  activityPreview,
  activityRowDetail,
} from '@waku/client/transcript-presentation';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ACTIVITY_ICONS } from './activity-icons';
import { activityHasDetail, useActivitySheet } from './activity-sheet';
import { AppSymbol } from './app-symbol';
import { useRowAnchor } from './transcript-anchor';
import { NativeTint } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Desktop's activity treatment, sized for a phone: the group collapses to a
 * single summary line (the live activity's title while streaming, "Ran N
 * commands · …" once settled), auto-expanded only while live, with its rows
 * hanging off a left rail as bordered cards headed by a bold action label.
 * The cards never expand in place — tapping one opens the native detail
 * sheet (`ActivitySheetHost`), so the transcript's scroll position stays
 * out of the picture and the disclosure reads like every other one on the
 * platform.
 */
export const ActivityGroup = memo(function ActivityGroup({
  block,
  live,
}: {
  block: TranscriptBlock;
  live: boolean;
}) {
  const theme = useTheme();
  const keepTop = useRowAnchor();
  const activities = activitiesForBlock(block);
  const [expanded, setExpanded] = useState(live);
  useEffect(() => {
    setExpanded(live);
  }, [live]);
  if (!activities.length) return null;
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => keepTop(() => setExpanded((value) => !value))}
        style={({ pressed }) => [styles.groupHeader, { opacity: pressed ? 0.6 : 1 }]}>
        <Text numberOfLines={1} style={[styles.groupTitle, { color: theme.textSecondary }]}>
          {activityHeaderTitle(activities, live)}
        </Text>
        <AppSymbol
          name={expanded
            ? { ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }
            : { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={10}
          tintColor={theme.textGhost}
        />
      </Pressable>
      {expanded && (
        <View style={[styles.rail, { borderLeftColor: theme.border }]}>
          {activities.map((activity) => (
            <ActivityRow activity={activity} block={block} key={activity.id} />
          ))}
        </View>
      )}
    </View>
  );
});

function ActivityRow({ activity, block }: { activity: ActivityItem; block: TranscriptBlock }) {
  const theme = useTheme();
  const openSheet = useActivitySheet();
  const hasDetail = activityHasDetail(activity);
  const preview = activity.reasoning ? '' : activityPreview(activity);
  const rowDetail = activityRowDetail(activity) || preview;
  const fileStats = activityFileChangeStats(activity);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityHint={hasDetail ? 'Opens the details' : undefined}
        accessibilityRole={hasDetail ? 'button' : 'text'}
        disabled={!hasDetail}
        onPress={() => openSheet({
          activityId: activity.id,
          turnId: block.turn_id,
          afterMessage: block.after_message,
        })}
        style={({ pressed }) => [
          styles.cardHeader,
          { backgroundColor: pressed && hasDetail ? theme.overlay : 'transparent' },
        ]}>
        <AppSymbol
          name={ACTIVITY_ICONS[activity.kind]}
          size={12}
          tintColor={theme.textTertiary}
        />
        <Text style={[styles.actionLabel, { color: activity.failed ? theme.danger : theme.textSecondary }]}>
          {activityActionLabel(activity)}
        </Text>
        {rowDetail ? (
          <Text numberOfLines={1} style={[styles.rowDetail, { color: theme.textSecondary }]}>
            {rowDetail}
          </Text>
        ) : (
          <View style={styles.rowSpacer} />
        )}
        {fileStats && (
          <Text style={styles.stats}>
            <Text style={{ color: theme.success }}>+{fileStats.additions}</Text>
            <Text style={{ color: theme.textGhost }}> </Text>
            <Text style={{ color: theme.danger }}>−{fileStats.deletions}</Text>
          </Text>
        )}
        <ActivityState activity={activity} hasDetail={hasDetail} />
      </Pressable>
    </View>
  );
}

/** Mirrors the desktop row's trailing state: a disclosure chevron when there
 * is detail to open, nothing for finished reasoning, an alert for failures,
 * a dot while live. */
function ActivityState({ activity, hasDetail }: { activity: ActivityItem; hasDetail: boolean }) {
  const theme = useTheme();
  if (hasDetail) {
    return (
      <AppSymbol
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={10}
        tintColor={theme.textGhost}
      />
    );
  }
  if (activity.reasoning) return null;
  if (activity.failed) {
    return (
      <AppSymbol
        name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }}
        size={12}
        tintColor={theme.danger}
      />
    );
  }
  if (activity.complete) return null;
  return <View accessibilityLabel="Running" style={[styles.runningDot, { backgroundColor: NativeTint }]} />;
}

const styles = StyleSheet.create({
  group: { marginBottom: 10 },
  groupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 28,
  },
  groupTitle: { flexShrink: 1, fontSize: 13, fontWeight: '500' },
  rail: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 7,
    marginLeft: 4,
    marginTop: 2,
    paddingBottom: 2,
    paddingLeft: 11,
  },
  card: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 9,
  },
  actionLabel: { fontSize: 12.5, fontWeight: '600' },
  rowDetail: { flex: 1, fontSize: 12.5 },
  rowSpacer: { flex: 1 },
  stats: { fontSize: 11.5, fontVariant: ['tabular-nums'], fontWeight: '600' },
  runningDot: { borderRadius: 3, height: 6, width: 6 },
});
