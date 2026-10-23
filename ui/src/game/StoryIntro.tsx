import { useCallback, useEffect, useState } from "react";
import "./story-intro.css";

type StoryIntroProps = {
  onFinish: () => void;
  onSkip: () => void;
};

const chapters = [
  {
    label: "THE RELEASE PIPELINE",
    title: "FRIDAY. 16:59.",
    narration:
      "Microsoft releases reach production through the packaging team. Reviewed, signed, and supported. Powershell Man finds this suspiciously boring.",
    bubble: "Use the vendor release. Let Packaging verify and distribute it.",
    speaker: "THE ARCHITECT",
    caption: "A predictable release process. Our hero senses a problem.",
  },
  {
    label: "THE INTERNAL BUILD",
    title: "WE'LL BUILD IT OURSELVES",
    narration:
      "Powershell Man has a plan: compile PowerShell and other Microsoft software, then have Packaging distribute his internal binaries in place of Microsoft's releases.",
    bubble: "Why wait for Microsoft? Packaging can ship MY builds instead!",
    speaker: "POWERSHELL MAN",
    caption: "The vendor release pipeline is now a folder called final_FINAL.",
  },
  {
    label: "THE REVIEW",
    title: "THE ARCHITECT STRIKES",
    narration:
      "The DevSecOps architect raises a clipboard shield. Someone has to own the replacement release chain after the first build succeeds.",
    bubble: "Who owns signing, security updates, provenance, and support?",
    speaker: "THE ARCHITECT",
    caption:
      "He wants a supportable release chain. Powershell Man calls it villainy.",
  },
] as const;

export function StoryIntro({ onFinish, onSkip }: StoryIntroProps) {
  const [chapter, setChapter] = useState(0);
  const beat = chapters[chapter]!;
  const advance = useCallback(() => {
    if (chapter === chapters.length - 1) onFinish();
    else setChapter((current) => Math.min(current + 1, chapters.length - 1));
  }, [chapter, onFinish]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest("button") || target.isContentEditable)
      )
        return;
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advance, onSkip]);

  function goBack() {
    setChapter((current) => Math.max(0, current - 1));
  }

  return (
    <section
      className={`pm-story pm-story--panel-${chapter + 1}`}
      aria-label="Powershell Man: origin story"
      aria-roledescription="comic"
    >
      <div className="pm-story__art" aria-hidden="true" />
      <div className="pm-story__shade" aria-hidden="true" />
      <header className="pm-story__topline">
        <span>
          TOIL COMICS <i>✦</i> INCIDENT ZERO
        </span>
        <span
          className="pm-story__counter"
          aria-label={`Panel ${chapter + 1} of 3`}
        >
          {String(chapter + 1).padStart(2, "0")} <b>/</b> 03
        </span>
      </header>
      <div
        className="pm-story__content"
        role="group"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`${beat.label}, panel ${chapter + 1} of 3`}
        key={chapter}
      >
        <div className="pm-story__eyebrow">{beat.label}</div>
        <h1>{beat.title}</h1>
        <p className="pm-story__narration">{beat.narration}</p>
        <div className="pm-story__bubble">
          <span>{beat.speaker}</span>
          <p>{beat.bubble}</p>
        </div>
        <p className="pm-story__caption">{beat.caption}</p>
      </div>
      <footer className="pm-story__footer">
        <div className="pm-story__dots" aria-label="Story progress">
          {chapters.map((item, index) => (
            <span
              key={item.label}
              className={index === chapter ? "is-current" : ""}
              aria-hidden="true"
            />
          ))}
        </div>
        <div className="pm-story__actions">
          <button className="pm-story__skip" onClick={onSkip}>
            SKIP STORY <kbd>ESC</kbd>
          </button>
          <div className="pm-story__step-actions">
            <button
              className="pm-story__back"
              onClick={goBack}
              disabled={chapter === 0}
              aria-label="Previous panel"
            >
              ←
            </button>
            <button className="pm-story__next" onClick={advance}>
              {chapter === chapters.length - 1 ? "START GAME" : "NEXT PANEL"}
              <span aria-hidden="true"> ↗</span>
            </button>
          </div>
        </div>
        <div className="pm-story__hint" aria-hidden="true">
          ENTER / SPACE TO ADVANCE
        </div>
      </footer>
    </section>
  );
}
