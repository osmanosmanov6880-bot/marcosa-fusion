// Export only the account's own season content and actions. Individual
// voters, viewers and business partner references belong to other accounts.
export function exportSeasonData(db, userId) {
 const seasons=db.prepare(`SELECT s.id,s.slug,s.title,s.description,s.next_at AS nextAt,
  s.created_at AS createdAt,w.slug AS world FROM series s JOIN worlds w ON w.id=s.world_id
  WHERE s.owner_id=? ORDER BY s.id`).all(userId);
 const episodes=db.prepare(`SELECT e.id,e.series_id AS seriesId,e.post_id AS postId,e.position,
  e.title,e.created_at AS createdAt,f.minutes FROM series_episodes e
  JOIN series s ON s.id=e.series_id LEFT JOIN series_effort f ON f.episode_id=e.id
  WHERE s.owner_id=? ORDER BY e.series_id,e.position`).all(userId);
 const polls=db.prepare(`SELECT p.episode_id AS episodeId,p.question,p.first_option AS firstOption,
  p.second_option AS secondOption,p.closes_at AS closesAt,p.result_note AS resultNote,
  p.result_episode_id AS resultEpisodeId,p.first_total AS firstTotal,p.second_total AS secondTotal
  FROM episode_polls p JOIN series_episodes e ON e.id=p.episode_id
  JOIN series s ON s.id=e.series_id WHERE s.owner_id=? ORDER BY p.episode_id`).all(userId);
 const partnerVisits=db.prepare(`SELECT s.slug AS season,sp.id AS placementId
  FROM season_partner_visits v JOIN season_placements sp ON sp.id=v.placement_id
  JOIN series s ON s.id=sp.series_id WHERE v.user_id=? ORDER BY sp.id`).all(userId);
 return {seasons,episodes,polls,partnerVisits};
}
