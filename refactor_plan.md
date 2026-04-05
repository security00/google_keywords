"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { 
  ExpandResponse, 
  CompareResponse, 
  OrganizedCandidates, 
  ComparisonResult,
  DEFAULT_KEYWORDS,
  DEFAULT_BENCHMARK,
  DEFAULT_FILTER_TERMS,
  TASK_COST_USD
} from "@/lib/types";

// ... (Copy all types from keyword-research.tsx: LogEntry, LogLevel, etc) ...
// We will move types to lib/types.ts if not present, or define here for now if they are local.

interface ResearchContextType {
  // State
  user: User | null;
  expandData: ExpandResponse | null;
  compareData: CompareResponse | null;
  selected: Set<string>;
  loadingExpand: boolean;
  loadingCompare: boolean;
  debugLogs: LogEntry[];
  
  // Inputs
  keywordsText: string;
  setKeywordsText: (val: string) => void;
  // ... other inputs ...

  // Actions
  handleExpand: () => Promise<void>;
  handleCompare: () => Promise<void>;
  toggleCandidate: (keyword: string) => void;
  // ... others ...
}

// This plan involves:
// 1. Creating internal-types.ts for the local types in KeywordResearch
// 2. Creating research-context.tsx
// 3. Refactoring components to consume context
// 4. Creating page wrappers
