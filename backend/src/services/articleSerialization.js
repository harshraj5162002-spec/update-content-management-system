// Public (non-owner, non-admin) view of an article. Internal editorial data - reviewer identity and feedback,
// moderation reasons/overrides, cached AI output and quiz answers - is never included.
function serializePublicArticle(article) {
  if (!article) return article;

  const { review, aiSummaryCache, moderation, quiz, ...publicArticle } = article;
  if (moderation) publicArticle.moderation = { status: moderation.status, riskScore: moderation.riskScore };
  if (quiz?.questions) {
    publicArticle.quiz = { questions: quiz.questions.map(({ prompt, options }) => ({ prompt, options })) };
  } else if (quiz !== undefined) {
    publicArticle.quiz = quiz;
  }
  return publicArticle;
}

// Author statistics embed full article records in topArticles; make them safe for public endpoints.
function serializePublicAuthorStats(stats) {
  if (!stats) return stats;
  return { ...stats, topArticles: (stats.topArticles || []).map(serializePublicArticle) };
}

// Fields of another person's account that are safe to show publicly. Email, reputation, interests,
// recommendation feedback and restriction details stay private.
function serializePublicUser(user) {
  if (!user) return null;
  const { id, name, bio, avatar, role } = user;
  return { id, name, bio, avatar, role };
}

module.exports = { serializePublicArticle, serializePublicAuthorStats, serializePublicUser };
