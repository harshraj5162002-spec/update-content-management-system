function serializePublicArticle(article) {
  if (!article) return article;
  if (!article.quiz?.questions) return article;

  return {
    ...article,
    quiz: {
      questions: article.quiz.questions.map(({ prompt, options }) => ({ prompt, options })),
    },
  };
}

module.exports = { serializePublicArticle };
