"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useSse } from "@/hooks/use-fetch";
import { LogDetailsDialog } from "./__components/log-details-dialog";
import { LogsFilters } from "./__components/logs-filters";
import { LogsTable } from "./__components/logs-table";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export type Log = {
	id: string;
	level: LogLevel;
	category: string;
	message: string;
	timestamp: Date;
	userId?: string;
	path?: string;
	details: Record<string, unknown>;
};

export function LogsSettings() {
	const [logs, setLogs] = useState<Log[]>([]);
	const [filteredLogs, setFilteredLogs] = useState<Log[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedLog, setSelectedLog] = useState<Log | null>(null);

	const [levelFilter, setLevelFilter] = useState<LogLevel[]>([]);
	const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [dateRange, setDateRange] = useState<{
		from: Date | null;
		to: Date | null;
	}>({
		from: null,
		to: null,
	});

	useEffect(() => {
		applyFilters();
	}, [logs, levelFilter, categoryFilter, searchQuery, dateRange]);

	const {
		data: sseData,
		loading: sseLoading,
		error: sseError,
	} = useSse<Log[]>("/api/logs?intervalMs=1000");

	useEffect(() => {
		if (sseError) {
			console.error("SSE logs error", sseError);
			setLoading(false);
			return;
		}

		setLoading(sseLoading);

		if (!sseData) return;

		const incoming = (Array.isArray(sseData) ? sseData : [sseData]).map(
			(log: Omit<Log, "timestamp"> & { timestamp: string }) => ({
				...log,
				timestamp: new Date(log.timestamp),
			}),
		) as Log[];

		setLogs((prev) => {
			const map = new Map<string, Log>();
			for (const l of prev) map.set(l.id, l);
			for (const l of incoming) map.set(l.id, l);
			const merged = Array.from(map.values());
			merged.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
			return merged;
		});
	}, [sseData, sseLoading, sseError]);

	function applyFilters() {
		let filtered = [...logs];

		if (levelFilter.length > 0) {
			filtered = filtered.filter((log) => levelFilter.includes(log.level));
		}

		if (categoryFilter.length > 0) {
			filtered = filtered.filter((log) =>
				categoryFilter.includes(log.category),
			);
		}

		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(log) =>
					log.message.toLowerCase().includes(query) ||
					log.category.toLowerCase().includes(query) ||
					log.userId?.toLowerCase().includes(query) ||
					log.path?.toLowerCase().includes(query),
			);
		}

		if (dateRange.from) {
			filtered = filtered.filter((log) => log.timestamp >= dateRange.from!);
		}
		if (dateRange.to) {
			filtered = filtered.filter((log) => log.timestamp <= dateRange.to!);
		}

		setFilteredLogs(filtered);
	}

	const categories = Array.from(new Set(logs.map((log) => log.category)));

	if (loading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<Spinner className="h-8 w-8" />
			</div>
		);
	}

	return (
		<div className="p-6 space-y-4">
			<LogsFilters
				levelFilter={levelFilter}
				setLevelFilter={setLevelFilter}
				categoryFilter={categoryFilter}
				setCategoryFilter={setCategoryFilter}
				searchQuery={searchQuery}
				setSearchQuery={setSearchQuery}
				dateRange={dateRange}
				setDateRange={setDateRange}
				categories={categories}
				totalLogs={logs.length}
				filteredCount={filteredLogs.length}
				onRefresh={() => {
					setLogs([]);
					setLoading(true);
				}}
			/>

			<LogsTable logs={filteredLogs} onSelectLog={setSelectedLog} />

			<LogDetailsDialog
				log={selectedLog}
				onClose={() => setSelectedLog(null)}
			/>
		</div>
	);
}
