import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark-dimmed.css';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import sql from 'highlight.js/lib/languages/sql';

hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('docker', dockerfile);
hljs.registerLanguage('elixir', elixir);
hljs.registerLanguage('sql', sql);

const transport = new DefaultChatTransport({ api: '/api/ask' });

function SparklesIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function InlineCode({ children }: { children?: React.ReactNode }) {
  return (
    <code className="rounded bg-gray-200 px-1 py-0.5 text-[11px] font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
      {children}
    </code>
  );
}

function PreBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const codeElement = children as React.ReactElement<{
    children?: string;
    className?: string;
  }>;
  const className = codeElement?.props?.className || '';
  const text = String(codeElement?.props?.children || '').replace(/\n$/, '');
  const language = className.replace('language-', '');

  const highlightedHtml = useMemo(() => {
    if (!text) return '';
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(text, { language }).value;
      }
      return hljs.highlightAuto(text).value;
    } catch {
      return '';
    }
  }, [text, language]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <div className="group relative my-2 overflow-hidden rounded-lg border border-gray-200 bg-gray-950 dark:border-gray-700">
      {language && (
        <div className="flex items-center justify-between border-b border-gray-800 px-3 py-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-gray-500">{language}</span>
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute right-2 top-1.5 rounded-md p-1 text-gray-500 opacity-0 transition-all hover:text-gray-300 group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <pre className="overflow-x-auto p-3 !m-0 !bg-transparent">
        {highlightedHtml ? (
          <code
            className="hljs text-[11px] font-mono leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <code className="text-[11px] font-mono leading-relaxed text-gray-200">{text}</code>
        )}
      </pre>
    </div>
  );
}


export default function AskAI() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { messages, sendMessage, status, setMessages } = useChat({ transport });
  const isLoading = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  function onSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput('');
  }

  function handleClose() {
    setIsOpen(false);
    setMessages([]);
    setInput('');
  }

  function getMessageText(msg: (typeof messages)[number]): string {
    for (const part of msg.parts) {
      if (part.type === 'text') return part.text;
    }
    return '';
  }

  if (!isOpen) {
    return (
      <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none">
        <button
          onClick={() => setIsOpen(true)}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm text-gray-500 shadow-lg transition-all hover:border-brand-300 hover:text-brand-600 hover:shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-brand-600 dark:hover:text-brand-400"
        >
          <SparklesIcon size={14} />
          Ask AI
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-xl px-4">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
          {messages.length > 0 && (
            <div className="max-h-[50vh] overflow-y-auto px-4 pt-4 pb-2 space-y-3">
              {messages.map((msg) => {
                const text = getMessageText(msg);
                if (!text) return null;
                return (
                  <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                    <div
                      className={`inline-block max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                          : 'bg-gray-50 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <div className="whitespace-pre-wrap">{text}</div>
                      ) : (
                        <div className="ask-ai-markdown prose prose-sm prose-gray max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:my-2 prose-pre:bg-gray-100 prose-pre:dark:bg-gray-900 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-a:text-brand-600 dark:prose-a:text-brand-400">
                          <Markdown components={{ code: InlineCode, pre: PreBlock }}>{text}</Markdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {isLoading && messages.length > 0 && getMessageText(messages[messages.length - 1]) === '' && (
                <div className="flex gap-1 px-1 py-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-300 dark:bg-gray-600" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-300 dark:bg-gray-600" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-300 dark:bg-gray-600" style={{ animationDelay: '300ms' }} />
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          <form onSubmit={onSubmit} className="flex items-center gap-2 px-4 py-3">
            <SparklesIcon size={16} />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question..."
              className="flex-1 border-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none dark:text-gray-100 dark:placeholder-gray-500"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={handleClose}
              className="shrink-0 rounded-md p-1 text-gray-300 transition-colors hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
