"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type GroundedAssistantSummary = {
  summary: string;
  total_predictions_today: number;
  average_risk_today: number;
  critical_alerts_week: number;
  warning_alerts_week: number;
  top_regions: string[];
  question: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

const QUICK_PROMPTS = [
  "What region currently has the highest risk?",
  "Summarize warning vs critical alerts today.",
  "Is weather auto-fill being used frequently?",
];

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatNowTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function getGroundedAssistantResponse(question: string): Promise<GroundedAssistantSummary> {
  const params = new URLSearchParams();
  params.set("question", question);

  const response = await fetch(`${API_BASE_URL}/assistant/grounded-summary?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to read grounded assistant summary");
  }

  return (await response.json()) as GroundedAssistantSummary;
}

async function getAssistantChatResponse(question: string): Promise<GroundedAssistantSummary> {
  const response = await fetch(`${API_BASE_URL}/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    cache: "no-store",
  });

  if (!response.ok) {
    // fallback to grounded summary when chat provider/config isn't available
    return await getGroundedAssistantResponse(question);
  }

  const data = await response.json();
  const grounded = (data.grounded_summary ?? (await getGroundedAssistantResponse(question))) as GroundedAssistantSummary;

  return {
    summary: data.answer ?? grounded.summary,
    total_predictions_today: grounded.total_predictions_today,
    average_risk_today: grounded.average_risk_today,
    critical_alerts_week: grounded.critical_alerts_week,
    warning_alerts_week: grounded.warning_alerts_week,
    top_regions: grounded.top_regions,
    question: grounded.question ?? question,
  } as GroundedAssistantSummary;
}

export default function AIAssistant() {
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-welcome",
      role: "assistant",
      createdAt: "",
      content:
        "Ask a surveillance question and I will return a quick summary from the most recent outbreak predictions.",
    },
  ]);

  useEffect(() => {
    setMessages((prev) => {
      const copy = [...prev];
      if (copy[0] && !copy[0].createdAt) {
        copy[0].createdAt = formatNowTime();
      }
      return copy;
    });
  }, []);

  const canSend = useMemo(() => input.trim().length > 0 && !isThinking, [input, isThinking]);

  useEffect(() => {
    if (!messageContainerRef.current) {
      return;
    }

    messageContainerRef.current.scrollTo({
      top: messageContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isThinking]);

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!canSend) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  function applyPrompt(prompt: string) {
    if (isThinking) {
      return;
    }

    setInput(prompt);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = input.trim();
    if (!question || isThinking) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      createdAt: formatNowTime(),
      content: question,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsThinking(true);

    try {
      const [assistantPayload] = await Promise.all([getAssistantChatResponse(question), delay(2000)]);
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        createdAt: formatNowTime(),
        content: assistantPayload.summary,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        createdAt: formatNowTime(),
        content:
          "I could not load prediction history right now. The backend may be offline, but the chat UI is ready and will summarize SQLite records once connected.",
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <section className="group relative overflow-hidden rounded-3xl border border-slate-700/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.92)_0%,rgba(2,6,23,0.96)_100%)] shadow-2xl shadow-black/45 ring-1 ring-cyan-300/10">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-cyan-400/20 blur-3xl transition duration-700 group-hover:scale-110" />
      <div className="pointer-events-none absolute -left-10 bottom-8 h-28 w-28 rounded-full bg-emerald-400/10 blur-3xl" />

      <div className="relative border-b border-slate-700/80 bg-slate-900/65 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-200/35 bg-cyan-400/15 text-[11px] font-semibold tracking-wide text-cyan-100">
              AI
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold uppercase tracking-[0.14em] text-cyan-100">AI Field Assistant</h2>
              <p className="mt-0.5 text-xs text-slate-300">Operational summary from recent SQLite predictions</p>
            </div>
          </div>

          <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.1em] text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
            Monitoring
          </div>
        </div>
      </div>

      <div
        ref={messageContainerRef}
        className="relative h-[22rem] space-y-3 overflow-y-auto border-y border-slate-700/50 bg-[radial-gradient(circle_at_90%_10%,rgba(14,116,144,0.14),transparent_35%),radial-gradient(circle_at_10%_100%,rgba(16,185,129,0.08),transparent_30%)] px-4 py-4"
      >
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[92%] rounded-2xl border px-3.5 py-2.5 text-sm leading-6 shadow-lg ${
                  isUser
                    ? "border-cyan-300/45 bg-cyan-500/18 text-cyan-50 shadow-cyan-950/35"
                    : "border-slate-600/80 bg-slate-950/85 text-slate-100 shadow-black/30"
                }`}
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                  <span className={isUser ? "text-cyan-200" : "text-slate-300"}>{isUser ? "Official" : "Assistant"}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-500" />
                  <span>{message.createdAt}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-pretty">{message.content}</p>
              </div>
            </div>
          );
        })}

        {isThinking ? (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-600/80 bg-slate-950/85 px-3.5 py-2.5 text-sm text-slate-200 shadow-lg shadow-black/30">
              <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                <span>Assistant</span>
                <span className="h-1 w-1 rounded-full bg-slate-500" />
                <span>{formatNowTime()}</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Thinking over recent SQLite predictions</span>
                <div className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-bounce" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-bounce [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-bounce [animation-delay:240ms]" />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="relative bg-slate-950/65 p-3">
        <label htmlFor="ai-question" className="sr-only">
          Ask the AI field assistant
        </label>

        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => applyPrompt(prompt)}
              disabled={isThinking}
              className="shrink-0 rounded-full border border-slate-600 bg-slate-900/90 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            id="ai-question"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleQuestionKeyDown}
            placeholder="What is the current outbreak risk for Mumbai based on recent weather?"
            rows={2}
            className="min-h-[78px] flex-1 resize-none rounded-2xl border border-slate-600 bg-slate-900/95 px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none ring-cyan-300 transition placeholder:text-slate-500 focus:border-cyan-300/40 focus:ring-2"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-2xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-700"
          >
            Send
          </button>
        </div>

        <p className="mt-1.5 text-[11px] text-slate-400">Press Enter to send. Press Shift+Enter for a new line.</p>
      </form>
    </section>
  );
}
