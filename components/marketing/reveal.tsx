"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type RevealProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Stagger delay in ms, applied to the reveal transition. */
  delay?: number;
};

/**
 * Fade-up scroll reveal. Content renders fully visible in SSR and stays
 * visible without JS; when JS runs, the hidden state is armed pre-paint and
 * IntersectionObserver reveals the element as it enters the viewport.
 */
export function Reveal({ children, className = "", style, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element || !("IntersectionObserver" in window)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    const alreadyVisible = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
    if (alreadyVisible) {
      return;
    }

    element.classList.add("mk-reveal-armed");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("mk-reveal-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ ...style, transitionDelay: delay ? `${delay}ms` : undefined }}>
      {children}
    </div>
  );
}
