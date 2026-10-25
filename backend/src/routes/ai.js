const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { store } = require('../data/store');
const { aiProvider, geminiModel } = require('../config/env');
const { runAITool, generateGeminiAITool } = require('../services/aiService');
const { getRelatedArticles } = require('../services/analytics');
const { getArticleSummary } = require('../services/articleInsights');
const { asyncHandler } = require('../middleware/asyncHandler');
const { serializePublicArticle } = require('../services/articleSerialization');

const router = express.Router();
const supportedTools = new Set(['summary', 'summarizer', 'writing', 'improve', 'moderation', 'quality', 'topics', 'tags', 'title', 'grammar', 'related']);

function selectAssistantTool(message, role) {
  const request = message.toLowerCase();
  if (role === 'admin' && /\b(moderat|risk|spam|abuse|safety|review)\b|मॉडरेशन|जोखिम|स्पैम/.test(request)) return 'moderation';
  if (/\b(summar|summary|shorten|brief)\b|सारांश|संक्षेप/.test(request)) return 'summary';
  if (/\b(title|headline|heading)\b|शीर्षक/.test(request)) return 'title';
  if (/\b(tag|keyword|topic)\b|टैग|कीवर्ड|विषय/.test(request)) return 'tags';
  if (/\b(quality|grammar|readability|duplicate|structure)\b|गुणवत्ता|व्याकरण|पठनीयता/.test(request)) return 'quality';
  return 'writing';
}

function assistantReply(tool, result) {
  let suggestions = Array.isArray(result?.suggestions)
    ? result.suggestions.map((suggestion) => typeof suggestion === 'string'
      ? { type: 'note', value: suggestion, reason: 'Editorial check' }
      : suggestion)
    : [];
  if (tool === 'tags' && suggestions.length && suggestions.every((suggestion) => suggestion.type === 'note')) {
    suggestions = [{ type: 'tags', value: suggestions.map((suggestion) => suggestion.value), reason: 'Suggested from the current draft.' }];
  }
  if (tool === 'summary' && result?.summary) {
    suggestions.unshift({ type: 'summary', value: result.summary, reason: 'Summary based on the current draft.' });
  }
  if (tool === 'moderation') {
    return {
      text: `Moderation analysis: ${result.status || 'review'} risk category, score ${result.riskScore ?? 'unavailable'}. This is an advisory signal, not an approval decision.`,
      suggestions,
    };
  }
  if (suggestions.length) {
    return {
      text: `I reviewed the current draft and found ${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}. Review each one and apply only what you want.`,
      suggestions,
    };
  }
  return {
    text: tool === 'summary'
      ? 'I could not create a summary from this draft yet. Add some article content and try again.'
      : 'I did not find a specific change to suggest. You can ask for a title, summary, tags, writing improvements, or a quality check.',
    suggestions,
  };
}

router.post('/assistant', requireAuth, asyncHandler(async (req, res) => {
  if (!['author', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'The editorial copilot is available to authors and administrators.' });
  }
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 1000) {
    return res.status(400).json({ message: 'Enter a request between 1 and 1000 characters.' });
  }
  const article = req.body.article && typeof req.body.article === 'object' && !Array.isArray(req.body.article)
    ? req.body.article
    : {};
  const contentLength = `${article.title || ''}${article.summary || ''}${article.content || ''}`.length;
  if (contentLength > 100000) return res.status(413).json({ message: 'Article content exceeds the AI assistant limit.' });

  const tool = selectAssistantTool(message, req.user.role);
  let result;
  if (aiProvider === 'gemini') {
    try {
      result = await generateGeminiAITool(tool, article, store.articles);
    } catch (error) {
      if (error.code !== 'GEMINI_API_ERROR') throw error;
      return res.status(502).json({ message: error.message });
    }
  } else {
    result = runAITool(tool, article, store.articles);
  }
  const reply = assistantReply(tool, result || {});
  res.json({
    ...reply,
    action: tool,
    provider: aiProvider,
    note: 'Suggestions do not edit or publish the article unless you choose to apply them. Publication still requires administrator approval.',
  });
}));

router.post('/tools/:tool', requireAuth, asyncHandler(async (req, res) => {
  const { tool } = req.params;
  if (!supportedTools.has(tool)) return res.status(404).json({ message: 'AI tool not found.' });

  const article = req.body.article || {};
  if (req.body.articleId) {
    const savedArticle = store.articles.find((item) => item.id === req.body.articleId);
    if (!savedArticle) return res.status(404).json({ message: 'Article not found.' });
    if (savedArticle.status !== 'published' && savedArticle.authorId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'You cannot use tools on this article.' });
    }
    Object.assign(article, savedArticle);
  }

  const contentLength = `${article.title || ''}${article.summary || ''}${article.content || ''}`.length;
  if (contentLength > 100000) return res.status(413).json({ message: 'Article content exceeds the AI tool limit.' });

  if (tool === 'related') {
    const target = req.body.articleId
      ? store.articles.find((item) => item.id === req.body.articleId)
      : article;
    if (!target.id) return res.status(400).json({ message: 'Provide an articleId or article content.' });
    return res.json({ result: getRelatedArticles(target, store.articles).map(serializePublicArticle), generatedBy: 'local relevance engine' });
  }

  if (aiProvider === 'local' && ['summary', 'summarizer'].includes(tool) && req.body.articleId) {
    return res.json({
      result: getArticleSummary(article, Boolean(req.body.regenerate)),
      provider: 'local',
      providerMessage: 'Extractive local summary; regenerate to refresh the cached result.',
    });
  }

  let result;
  if (aiProvider === 'gemini') {
    try {
      result = await generateGeminiAITool(tool, article, store.articles);
    } catch (error) {
      if (error.code !== 'GEMINI_API_ERROR') throw error;
      return res.status(502).json({ message: error.message });
    }
    return res.json({ result, provider: 'gemini', providerMessage: `Generated by Gemini (${geminiModel}).` });
  }

  result = runAITool(tool, article, store.articles);
  if (!result) return res.status(404).json({ message: 'AI tool not found.' });
  res.json({ result, provider: 'local', providerMessage: 'Using deterministic local analysis.' });
}));

module.exports = router;
