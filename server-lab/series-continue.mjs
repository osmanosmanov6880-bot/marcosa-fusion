/** Explicit, voluntary reading progress; never infer a visit from a page view. */
export function nextUnreadEpisodes(db, viewerId, limit=50) {
 if(typeof viewerId!=='string'||!viewerId)throw Error('viewerId is required');
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('invalid limit');
 const sql=[
  "SELECT s.slug,s.title AS seriesTitle,e.id AS episodeId,e.position,e.title AS episodeTitle,w.slug AS world,s.next_at AS nextAt",
  "FROM series_subscriptions sub JOIN series s ON s.id=sub.series_id",
  "JOIN worlds w ON w.id=s.world_id AND w.owner_id=s.owner_id",
  "LEFT JOIN profile_cards pc ON pc.user_id=s.owner_id",
  "JOIN series_episodes e ON e.series_id=s.id",
  "JOIN posts p ON p.id=e.post_id AND p.author_id=s.owner_id AND p.world_id=s.world_id AND p.status='published'",
  "LEFT JOIN series_attendance a ON a.episode_id=e.id AND a.viewer_id=sub.user_id",
  "WHERE sub.user_id=? AND s.archived_at IS NULL AND w.visibility='public' AND a.episode_id IS NULL",
  "AND (COALESCE(pc.visibility,'public')='public' OR EXISTS (",
  " SELECT 1 FROM user_follows f WHERE f.follower_id=sub.user_id AND f.followed_id=s.owner_id AND f.status='active'))",
  "AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE",
  " (b.blocker_id=sub.user_id AND b.blocked_id=s.owner_id) OR (b.blocker_id=s.owner_id AND b.blocked_id=sub.user_id))",
  "AND NOT EXISTS (SELECT 1 FROM series_episodes earlier",
  " JOIN posts ep ON ep.id=earlier.post_id AND ep.author_id=s.owner_id AND ep.world_id=s.world_id AND ep.status='published'",
  " LEFT JOIN series_attendance ea ON ea.episode_id=earlier.id AND ea.viewer_id=sub.user_id",
  " WHERE earlier.series_id=s.id AND ea.episode_id IS NULL AND earlier.position < e.position)",
  "ORDER BY s.id DESC LIMIT ?"
 ].join('\n');
 return db.prepare(sql).all(viewerId,limit);
}
