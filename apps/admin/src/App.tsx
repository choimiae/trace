import type { DashboardSummary, Issue } from "@trace/shared";
import { useEffect, useState } from "react";
import { getDashboardData } from "./api";
import { DashboardPage } from "./pages/DashboardPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import "./styles.css";

export function App() {
  const [data, setData] = useState<{ summary: DashboardSummary; issues: Issue[] }>();
  const [selectedIssue, setSelectedIssue] = useState<Issue>();

  useEffect(() => {
    getDashboardData().then(setData);
  }, []);

  if (!data) return <main className="app-shell">불러오는 중</main>;

  return (
    <>
      <DashboardPage summary={data.summary} issues={data.issues} onSelectIssue={setSelectedIssue} />
      {selectedIssue ? <IssueDetailPage issue={selectedIssue} onClose={() => setSelectedIssue(undefined)} /> : null}
    </>
  );
}
