function isValidQuiz(quiz) {
  if (quiz === null) return true;
  if (!quiz || !Array.isArray(quiz.questions) || quiz.questions.length < 1 || quiz.questions.length > 20) {
    return false;
  }

  return quiz.questions.every((question) =>
    question &&
    typeof question.prompt === 'string' &&
    question.prompt.trim().length >= 5 &&
    question.prompt.trim().length <= 300 &&
    Array.isArray(question.options) &&
    question.options.length >= 2 &&
    question.options.length <= 6 &&
    question.options.every((option) =>
      typeof option === 'string' && option.trim().length >= 1 && option.trim().length <= 200
    ) &&
    Number.isInteger(question.correctOptionIndex) &&
    question.correctOptionIndex >= 0 &&
    question.correctOptionIndex < question.options.length
  );
}

function normalizeQuiz(quiz) {
  if (!quiz) return null;
  return {
    questions: quiz.questions.map((question) => ({
      prompt: question.prompt.trim(),
      options: question.options.map((option) => option.trim()),
      correctOptionIndex: question.correctOptionIndex,
    })),
  };
}

module.exports = { isValidQuiz, normalizeQuiz };
