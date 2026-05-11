import { App, ItemView, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface DailyWordCountSettings {
    diaryFolder: string;
    dateFormat: string;
    trackedTag: string;
}

interface TodayHistoryEntry {
    date: string;
    year: number;
    wordCount: number;
    preview: string;
}

const DEFAULT_SETTINGS: DailyWordCountSettings = {
    diaryFolder: '日记',
    dateFormat: 'YYYY-MM-DD',
    trackedTag: ''
};

const VIEW_TYPE_DIARY_NAVIGATOR = 'word-count-chart-view';

class DiaryNavigatorView extends ItemView {
    plugin: DiaryNavigatorPlugin;
    dailyChart: Chart | null = null;
    monthlyChart: Chart | null = null;
    currentDays = 30;
    currentHeatmapYear = new Date().getFullYear();
    dailyFullDates: string[] = [];
    monthlyFullMonths: string[] = [];
    daysSelect: HTMLSelectElement | null = null;
    memoryContainer: HTMLElement | null = null;
    heatmapContainer: HTMLElement | null = null;
    todayHistoryContainer: HTMLElement | null = null;
    heatmapYearLabel: HTMLElement | null = null;
    heatmapDaysLabel: HTMLElement | null = null;
    heatmapPeakLabel: HTMLElement | null = null;
    heatmapPrevBtn: HTMLButtonElement | null = null;
    heatmapNextBtn: HTMLButtonElement | null = null;
    heatmapResizeObserver: ResizeObserver | null = null;
    heatmapResizeFrame: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: DiaryNavigatorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_DIARY_NAVIGATOR;
    }

    getDisplayText(): string {
        return 'Diary Navigator';
    }

    getIcon(): string {
        return 'compass';
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('word-count-chart-view');

        container.createDiv('word-count-stats');

        const heatmapSection = this.createCard(container, { minWidth: '100%' });
        this.createPanelHeader(heatmapSection, '🗺️ 年度写作热力图', (actionsEl) => {
            actionsEl.style.cssText = `
                display: flex;
                gap: 12px;
                align-items: center;
                flex-wrap: wrap;
                margin-left: auto;
            `;

            const metaGroup = actionsEl.createDiv('heatmap-meta-group');
            metaGroup.style.cssText = `
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
                color: var(--text-muted);
                font-size: 12px;
            `;

            this.heatmapDaysLabel = metaGroup.createSpan({ text: '已记录 0 天' });
            this.heatmapPeakLabel = metaGroup.createSpan({ text: '峰值 0 字' });

            const legend = metaGroup.createDiv('heatmap-inline-legend');
            legend.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            legend.createSpan({ text: '少' });
            for (let i = 0; i < 5; i++) {
                const box = legend.createDiv('heatmap-legend-box');
                box.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border-radius: 4px;
                    border: 1px solid var(--background-modifier-border-hover);
                `;
                box.setAttribute('data-heatmap-legend', i.toString());
            }
            legend.createSpan({ text: '多' });

            const yearSwitch = actionsEl.createDiv('heatmap-year-switch');
            yearSwitch.style.cssText = `
                display: flex;
                align-items: center;
                gap: 6px;
            `;

            this.heatmapPrevBtn = yearSwitch.createEl('button', { text: '←' });
            this.heatmapPrevBtn.style.cssText = this.getCompactButtonStyle();
            this.heatmapPrevBtn.addEventListener('click', async () => {
                this.currentHeatmapYear--;
                await this.loadHeatmap();
            });

            this.heatmapYearLabel = yearSwitch.createSpan({ text: `${this.currentHeatmapYear}年` });
            this.heatmapYearLabel.style.cssText = `
                min-width: 56px;
                text-align: center;
                font-weight: 600;
            `;

            this.heatmapNextBtn = yearSwitch.createEl('button', { text: '→' });
            this.heatmapNextBtn.style.cssText = this.getCompactButtonStyle();
            this.heatmapNextBtn.addEventListener('click', async () => {
                const currentYear = new Date().getFullYear();
                if (this.currentHeatmapYear < currentYear) {
                    this.currentHeatmapYear++;
                    await this.loadHeatmap();
                }
            });
        });
        this.heatmapContainer = heatmapSection.createDiv('heatmap-container');
        this.heatmapContainer.style.cssText = `
            margin-top: 8px;
        `;
        this.setupHeatmapResizeObserver();

        const chartsWrapper = container.createDiv('charts-wrapper');
        chartsWrapper.style.cssText = `
            display: flex;
            gap: 20px;
            margin-top: 20px;
            flex-wrap: wrap;
        `;

        const dailyChartSection = this.createCard(chartsWrapper, { minWidth: '400px' });
        this.createPanelHeader(dailyChartSection, '📈 每日字数趋势', (actionsEl) => {
            this.daysSelect = actionsEl.createEl('select');
            this.daysSelect.style.cssText = this.getControlStyle();

            [7, 14, 30, 60, 90].forEach((days) => {
                const option = this.daysSelect!.createEl('option', {
                    text: `${days}天`,
                    value: days.toString()
                });
                option.selected = days === this.currentDays;
            });

            this.daysSelect.addEventListener('change', (event) => {
                this.currentDays = parseInt((event.target as HTMLSelectElement).value, 10);
                this.refreshDailyChart();
            });
        });

        const dailyChartContainer = dailyChartSection.createDiv('chart-container');
        dailyChartContainer.style.cssText = `
            height: 240px;
            margin-top: 10px;
        `;
        dailyChartContainer.createEl('canvas', { attr: { id: 'daily-word-chart' } });

        const monthlyChartSection = this.createCard(chartsWrapper, { minWidth: '400px' });
        this.createPanelHeader(monthlyChartSection, '📊 月度平均字数');
        const monthlyChartContainer = monthlyChartSection.createDiv('chart-container');
        monthlyChartContainer.style.cssText = `
            height: 240px;
            margin-top: 10px;
        `;
        monthlyChartContainer.createEl('canvas', { attr: { id: 'monthly-avg-chart' } });

        const memoryWrapper = container.createDiv('memory-wrapper');
        memoryWrapper.style.cssText = `
            display: flex;
            gap: 20px;
            margin-top: 20px;
            flex-wrap: wrap;
        `;

        const memorySection = this.createCard(memoryWrapper, {
            minWidth: '350px',
            background: 'linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%)'
        });
        this.createPanelHeader(memorySection, '🎐 回忆漫游', (actionsEl) => {
            const refreshMemoryBtn = actionsEl.createEl('button', {
                text: '🎲 换一批',
                cls: 'mod-cta'
            });
            refreshMemoryBtn.style.cssText = this.getButtonStyle();
            refreshMemoryBtn.addEventListener('click', () => {
                this.loadRandomMemories();
            });
        });
        this.memoryContainer = memorySection.createDiv('memory-container');
        this.memoryContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        const todayHistorySection = this.createCard(memoryWrapper, {
            minWidth: '350px',
            background: 'linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%)'
        });
        const lastYearStr = this.formatDate(this.getLastYearToday());
        this.createPanelHeader(todayHistorySection, `🕰️ 往年今日 (${lastYearStr.slice(5)})`, (actionsEl) => {
            const openLastYearBtn = actionsEl.createEl('button', {
                text: '📖 去年今日',
                cls: 'mod-cta'
            });
            openLastYearBtn.style.cssText = this.getButtonStyle();
            openLastYearBtn.addEventListener('click', () => {
                this.openDiaryFile(lastYearStr);
            });
        });
        this.todayHistoryContainer = todayHistorySection.createDiv('today-history-container');
        this.todayHistoryContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        const loadingDiv = container.createDiv('loading-indicator');
        loadingDiv.setText('加载数据中...');
        loadingDiv.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted);';

        window.setTimeout(async () => {
            loadingDiv.remove();
            await this.refreshAllCharts();
        }, 100);
    }

    async onClose() {
        this.dailyChart?.destroy();
        this.monthlyChart?.destroy();
        this.heatmapResizeObserver?.disconnect();
        if (this.heatmapResizeFrame !== null) {
            cancelAnimationFrame(this.heatmapResizeFrame);
            this.heatmapResizeFrame = null;
        }
    }

    createCard(container: HTMLElement, options?: { minWidth?: string; background?: string }) {
        const card = container.createDiv();
        card.style.cssText = `
            flex: 1;
            min-width: ${options?.minWidth ?? '400px'};
            padding: 16px;
            background: ${options?.background ?? 'var(--background-secondary)'};
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
        `;
        return card;
    }

    createPanelHeader(container: HTMLElement, title: string, buildActions?: (actionsEl: HTMLElement) => void) {
        const header = container.createDiv('section-header');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        `;
        const titleEl = header.createEl('h3', { text: title });
        titleEl.style.cssText = `
            margin: 0;
            line-height: 1.2;
        `;

        if (buildActions) {
            const actionsEl = header.createDiv('section-actions');
            actionsEl.style.cssText = `
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
            `;
            buildActions(actionsEl);
        }

        return header;
    }

    getButtonStyle() {
        return `
            padding: 6px 12px;
            font-size: 14px;
        `;
    }

    getCompactButtonStyle() {
        return `
            width: 28px;
            height: 28px;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        `;
    }

    setupHeatmapResizeObserver() {
        this.heatmapResizeObserver?.disconnect();
        if (!this.heatmapContainer) return;

        this.heatmapResizeObserver = new ResizeObserver(() => {
            if (this.heatmapResizeFrame !== null) {
                cancelAnimationFrame(this.heatmapResizeFrame);
            }
            this.heatmapResizeFrame = requestAnimationFrame(() => {
                this.heatmapResizeFrame = null;
                this.loadHeatmap();
            });
        });

        this.heatmapResizeObserver.observe(this.heatmapContainer);
    }

    getControlStyle() {
        return `
            padding: 4px 8px;
            font-size: 14px;
            border-radius: 4px;
            background-color: var(--background-modifier-form-field);
            border: 1px solid var(--background-modifier-border);
        `;
    }

    createStatsCard(container: HTMLElement) {
        const statItem = container.createDiv('stat-item');
        statItem.style.cssText = `
            padding: 14px;
            background-color: var(--background-primary);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
            transition: all 0.2s ease;
        `;
        statItem.addEventListener('mouseenter', () => {
            statItem.style.transform = 'translateY(-2px)';
            statItem.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
            statItem.style.borderColor = 'var(--interactive-accent)';
        });
        statItem.addEventListener('mouseleave', () => {
            statItem.style.transform = 'translateY(0)';
            statItem.style.boxShadow = 'none';
            statItem.style.borderColor = 'var(--background-modifier-border)';
        });
        return statItem;
    }

    getStatValueStyle() {
        return `
            font-size: 1.4em;
            font-weight: bold;
            color: var(--text-accent);
            margin-top: 5px;
        `;
    }

    async refreshAllCharts() {
        if (this.daysSelect) {
            this.daysSelect.value = this.currentDays.toString();
        }

        await this.refreshDailyChart();
        await this.refreshMonthlyChart();
        await this.loadHeatmap();
        await this.loadRandomMemories();
        await this.loadTodayHistory();
    }

    async refreshDailyChart() {
        const canvas = document.getElementById('daily-word-chart') as HTMLCanvasElement | null;
        if (!canvas) return;

        try {
            const data = await this.getDailyWordCountData(this.currentDays);
            this.dailyFullDates = data.fullDates;

            this.dailyChart?.destroy();
            this.dailyChart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: '每日字数',
                        data: data.counts,
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (_event, elements) => {
                        if (elements.length > 0) {
                            this.openDiaryFile(this.dailyFullDates[elements[0].index]);
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `字数: ${(context.parsed.y ?? 0).toLocaleString()}`,
                                title: (context) => this.dailyFullDates[context[0].dataIndex]
                            }
                        }
                    },
                    layout: {
                        padding: {
                            bottom: 0
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '字数'
                            },
                            ticks: {
                                callback: (value) => Number(value).toLocaleString()
                            }
                        },
                        x: {
                            ticks: {
                                padding: 2
                            },
                            title: {
                                display: true,
                                text: '日期',
                                padding: {
                                    top: 2,
                                    bottom: 0
                                }
                            }
                        }
                    }
                }
            });

            this.updateStats(data.counts, data.fullDates);
        } catch (error) {
            console.error('刷新每日图表时出错:', error);
        }
    }

    async refreshMonthlyChart() {
        const canvas = document.getElementById('monthly-avg-chart') as HTMLCanvasElement | null;
        if (!canvas) return;

        try {
            const data = await this.getMonthlyAvgData();
            this.monthlyFullMonths = data.fullMonths;

            this.monthlyChart?.destroy();
            this.monthlyChart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: '月均字数',
                        data: data.avgs,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgb(54, 162, 235)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: (_event, elements) => {
                        if (elements.length > 0) {
                            this.openMonthlySummary(this.monthlyFullMonths[elements[0].index]);
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `月均字数: ${Math.round(context.parsed.y ?? 0).toLocaleString()}`,
                                title: (context) => `${this.monthlyFullMonths[context[0].dataIndex]} 月均`
                            }
                        }
                    },
                    layout: {
                        padding: {
                            bottom: 0
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: '平均字数'
                            },
                            ticks: {
                                callback: (value) => Number(value).toLocaleString()
                            }
                        },
                        x: {
                            ticks: {
                                padding: 2
                            },
                            title: {
                                display: true,
                                text: '月份',
                                padding: {
                                    top: 2,
                                    bottom: 0
                                }
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('刷新月度图表时出错:', error);
        }
    }

    async loadHeatmap() {
        if (!this.heatmapContainer) return;

        const year = this.currentHeatmapYear;
        const dailyCounts = await this.getYearlyHeatmapData(year);
        const maxCount = Math.max(...Array.from(dailyCounts.values()), 0);
        const metrics = this.getHeatmapLayoutMetrics(this.heatmapContainer.clientWidth || 960);
        const { cellSize, gap, labelWidth, monthHeaderHeight } = metrics;

        if (this.heatmapYearLabel) {
            this.heatmapYearLabel.setText(`${year}年`);
        }
        if (this.heatmapDaysLabel) {
            this.heatmapDaysLabel.setText(`已记录 ${dailyCounts.size} 天`);
        }
        if (this.heatmapPeakLabel) {
            this.heatmapPeakLabel.setText(`峰值 ${maxCount.toLocaleString()} 字`);
        }
        if (this.heatmapNextBtn) {
            this.heatmapNextBtn.disabled = year >= new Date().getFullYear();
        }

        const legendBoxes = Array.from(this.containerEl.querySelectorAll('[data-heatmap-legend]')) as HTMLElement[];
        legendBoxes.forEach((box, index) => {
            const ratio = [0, 0.25, 0.5, 0.75, 1][index] ?? 0;
            box.style.backgroundColor = this.getHeatmapColor(Math.round(maxCount * ratio), maxCount);
        });

        this.heatmapContainer.empty();

        const wrapper = this.heatmapContainer.createDiv('heatmap-layout');
        wrapper.style.cssText = `
            display: grid;
            grid-template-columns: ${labelWidth}px 1fr;
            gap: ${gap + 4}px;
            align-items: start;
            overflow-x: auto;
        `;

        const labelsColumn = wrapper.createDiv('heatmap-weekday-labels');
        labelsColumn.style.cssText = `
            display: grid;
            grid-template-rows: repeat(7, ${cellSize}px);
            gap: ${gap}px;
            padding-top: ${monthHeaderHeight + 6}px;
            color: var(--text-muted);
            font-size: 11px;
        `;
        ['一', '', '三', '', '五', '', '日'].forEach((label) => {
            const el = labelsColumn.createDiv('heatmap-weekday-label');
            el.setText(label);
            el.style.cssText = `
                height: ${cellSize}px;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                line-height: 1;
            `;
        });

        const rightColumn = wrapper.createDiv('heatmap-right');
        rightColumn.style.cssText = `
            width: 100%;
        `;

        const monthHeader = rightColumn.createDiv('heatmap-month-header');
        monthHeader.style.cssText = `
            display: grid;
            grid-template-columns: repeat(53, ${cellSize}px);
            gap: ${gap}px;
            margin-bottom: 6px;
            color: var(--text-muted);
            font-size: 11px;
            min-height: ${monthHeaderHeight}px;
        `;

        const monthNames = new Array(53).fill('');
        for (let month = 0; month < 12; month++) {
            const monthDate = new Date(year, month, 1);
            const col = this.getWeekIndexInYear(monthDate, year);
            monthNames[col] = `${month + 1}月`;
        }
        monthNames.forEach((name) => {
            const cell = monthHeader.createDiv('heatmap-month-cell');
            cell.setText(name);
        });

        const grid = rightColumn.createDiv('heatmap-grid');
        grid.style.cssText = `
            display: grid;
            grid-auto-flow: column;
            grid-template-columns: repeat(53, ${cellSize}px);
            grid-template-rows: repeat(7, ${cellSize}px);
            gap: ${gap}px;
        `;

        for (let week = 0; week < 53; week++) {
            for (let weekday = 0; weekday < 7; weekday++) {
                const cellDate = this.getDateForWeekCell(year, week, weekday);
                const cell = grid.createDiv('heatmap-cell');
                cell.style.cssText = `
                    width: ${cellSize}px;
                    height: ${cellSize}px;
                    border-radius: ${Math.max(3, Math.floor(cellSize / 3.5))}px;
                    background-color: ${this.getHeatmapColor(this.getDateCount(dailyCounts, cellDate), maxCount)};
                    border: 1px solid var(--background-modifier-border-hover);
                    box-sizing: border-box;
                    cursor: ${cellDate && this.getDateCount(dailyCounts, cellDate) > 0 ? 'pointer' : 'default'};
                `;

                if (!cellDate || cellDate.getFullYear() !== year) {
                    cell.style.opacity = '0.22';
                } else {
                    const dateStr = this.formatDate(cellDate);
                    const count = this.getDateCount(dailyCounts, cellDate);
                    cell.setAttribute('title', `${dateStr} · ${count.toLocaleString()} 字`);
                    if (count > 0) {
                        cell.addEventListener('click', () => {
                            this.openDiaryFile(dateStr);
                        });
                    }
                }
            }
        }
    }

    async loadTodayHistory() {
        if (!this.todayHistoryContainer) return;

        this.todayHistoryContainer.empty();

        const loadingItem = this.todayHistoryContainer.createDiv('loading-item');
        loadingItem.setText('加载中...');
        loadingItem.style.cssText = `
            color: var(--text-muted);
            text-align: center;
            padding: 20px;
        `;

        const entries = await this.getTodayHistoryEntries();
        this.todayHistoryContainer.empty();

        if (entries.length === 0) {
            const emptyItem = this.todayHistoryContainer.createDiv('empty-item');
            emptyItem.setText('历史上这一天还没有找到日记记录');
            emptyItem.style.cssText = `
                color: var(--text-muted);
                text-align: center;
                padding: 20px;
            `;
            return;
        }

        entries.forEach((entry, index) => {
            const item = this.todayHistoryContainer!.createDiv('history-item');
            item.style.cssText = `
                position: relative;
                padding: 14px 16px;
                background-color: var(--background-primary);
                border-radius: 8px;
                border-left: 4px solid ${index === 0 ? 'var(--interactive-accent)' : 'var(--background-modifier-border-hover)'};
                cursor: pointer;
                transition: all 0.2s ease;
            `;

            const titleRow = item.createDiv('history-item-title');
            titleRow.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                margin-bottom: 8px;
                flex-wrap: wrap;
            `;
            titleRow.createSpan({ text: `📅 ${entry.date}` });

            const wordChip = titleRow.createSpan({ text: `${entry.wordCount.toLocaleString()} 字` });
            wordChip.style.cssText = `
                padding: 2px 8px;
                border-radius: 999px;
                background-color: var(--background-modifier-hover);
                color: var(--text-muted);
                font-size: 0.85em;
            `;

            const preview = item.createDiv('history-item-preview');
            preview.innerHTML = this.escapeHtml(entry.preview).replace(/\n/g, '<br>');
            preview.style.cssText = `
                line-height: 1.7;
                color: var(--text-normal);
                font-size: 0.95em;
            `;

            item.addEventListener('mouseenter', () => {
                item.style.transform = 'translateX(4px)';
                item.style.backgroundColor = 'var(--background-secondary)';
            });
            item.addEventListener('mouseleave', () => {
                item.style.transform = 'translateX(0)';
                item.style.backgroundColor = 'var(--background-primary)';
            });
            item.addEventListener('click', () => {
                this.openDiaryFile(entry.date);
            });
        });
    }

    async getDailyWordCountData(days: number) {
        const labels: string[] = [];
        const counts: number[] = [];
        const fullDates: string[] = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = this.formatDate(date);

            labels.push(dateStr.slice(5));
            fullDates.push(dateStr);
            counts.push(await this.getWordCountForDate(dateStr));
        }

        return { labels, counts, fullDates };
    }

    async getMonthlyAvgData() {
        const labels: string[] = [];
        const avgs: number[] = [];
        const fullMonths: string[] = [];

        const months = await this.getAllMonths();
        months.sort();

        for (const month of months) {
            const [, monthNum] = month.split('-');
            labels.push(`${monthNum}月`);
            fullMonths.push(month);
            avgs.push(await this.calculateMonthlyAverage(month));
        }

        return { labels, avgs, fullMonths };
    }

    async getAllMonths(): Promise<string[]> {
        return Array.from(new Set(this.getDiaryFiles().map((file) => file.basename.slice(0, 7))));
    }

    async calculateMonthlyAverage(month: string): Promise<number> {
        const [year, monthNum] = month.split('-');
        const daysInMonth = new Date(parseInt(year, 10), parseInt(monthNum, 10), 0).getDate();

        let totalWords = 0;
        let daysWithContent = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${monthNum}-${String(day).padStart(2, '0')}`;
            const wordCount = await this.getWordCountForDate(dateStr);
            if (wordCount > 0) {
                totalWords += wordCount;
                daysWithContent++;
            }
        }

        return daysWithContent > 0 ? totalWords / daysWithContent : 0;
    }

    async getYearlyHeatmapData(year: number): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        const diaryFiles = this.getDiaryFiles().filter((file) => file.basename.startsWith(`${year}-`));

        for (const file of diaryFiles) {
            result.set(file.basename, this.countWords(await this.app.vault.read(file)));
        }

        return result;
    }

    async getTodayHistoryEntries(): Promise<TodayHistoryEntry[]> {
        const today = new Date();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const currentYear = today.getFullYear();
        const suffix = `-${month}-${day}`;

        const entries: TodayHistoryEntry[] = [];

        for (const file of this.getDiaryFiles()) {
            if (!file.basename.endsWith(suffix)) {
                continue;
            }

            const entryYear = parseInt(file.basename.slice(0, 4), 10);
            if (entryYear >= currentYear) {
                continue;
            }

            const content = await this.app.vault.read(file);
            const cleaned = this.stripFrontmatter(content).trim();
            entries.push({
                date: file.basename,
                year: entryYear,
                wordCount: this.countWords(content),
                preview: this.createPreviewText(cleaned, 220)
            });
        }

        return entries.sort((a, b) => b.year - a.year);
    }

    async openDiaryFile(dateStr: string) {
        const file = this.app.vault.getAbstractFileByPath(`${this.plugin.settings.diaryFolder}/${dateStr}.md`);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }

    async openMonthlySummary(monthStr: string) {
        const filePath = `${this.plugin.settings.diaryFolder}/${monthStr}.md`;
        let file = this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            file = await this.app.vault.create(filePath, '');
        }

        if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }

    async getWordCountForDate(dateStr: string): Promise<number> {
        const file = this.app.vault.getAbstractFileByPath(`${this.plugin.settings.diaryFolder}/${dateStr}.md`);
        if (!(file instanceof TFile)) {
            return 0;
        }

        try {
            return this.countWords(await this.app.vault.read(file));
        } catch {
            return 0;
        }
    }

    countWords(text: string): number {
        let normalized = text;
        normalized = normalized.replace(/^---[\s\S]*?---\n?/u, '');
        normalized = normalized.replace(/```[\s\S]*?```/gu, ' ');
        normalized = normalized.replace(/`[^`]*`/gu, ' ');
        normalized = normalized.replace(/!\[([^\]]*)\]\((.*?)\)/gu, ' $1 ');
        normalized = normalized.replace(/\[([^\]]+)\]\((.*?)\)/gu, ' $1 ');
        normalized = normalized.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, ' $2 ');
        normalized = normalized.replace(/\[\[([^\]]+)\]\]/gu, ' $1 ');
        normalized = normalized.replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gmu, '');
        normalized = normalized.replace(/[#*_~>|]/gu, ' ');
        normalized = normalized.replace(/\s+/gu, ' ').trim();

        const hanChars = normalized.match(/\p{Script=Han}/gu) ?? [];
        const latinBase = normalized.replace(/\p{Script=Han}/gu, ' ');
        const englishWords = latinBase.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? [];

        return hanChars.length + englishWords.length;
    }

    stripFrontmatter(text: string): string {
        return text.replace(/^---[\s\S]*?---\n?/u, '');
    }

    createPreviewText(text: string, maxLength: number) {
        const flat = text
            .replace(/\n{2,}/g, '\n')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 3)
            .join('\n');

        if (flat.length <= maxLength) {
            return flat || '这一天写下了一些内容。';
        }

        return `${flat.slice(0, maxLength)}...`;
    }

    extractMemoryCandidateLines(text: string): string[] {
        const cleaned = this.stripFrontmatter(text)
            .replace(/```[\s\S]*?```/gu, '\n')
            .replace(/!\[\[.*?\]\]/gu, '\n')
            .replace(/!\[.*?\]\(.*?\)/gu, '\n')
            .replace(/<img[\s\S]*?>/giu, '\n')
            .replace(/<iframe[\s\S]*?<\/iframe>/giu, '\n');

        return cleaned.split('\n')
            .map((line) => line.trim())
            .filter((line) => {
                return line.length > 10
                    && !line.startsWith('#')
                    && !line.startsWith('- [ ]')
                    && !line.startsWith('- [x]')
                    && !/^[0-9]+\./.test(line)
                    && !line.startsWith('>')
                    && !line.startsWith('|')
                    && !line.includes('```')
                    && !line.includes('```chart')
                    && !/^!\[\[.*\]\]$/.test(line)
                    && !/^!\[.*\]\(.*\)$/.test(line);
            });
    }

    formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    getLastYearToday() {
        const today = new Date();
        const lastYearDate = new Date(today);
        lastYearDate.setFullYear(today.getFullYear() - 1);
        return lastYearDate;
    }

    getWeekIndexInYear(date: Date, year: number) {
        const yearStart = new Date(year, 0, 1);
        const offset = (yearStart.getDay() + 6) % 7;
        const diffDays = Math.floor((date.getTime() - yearStart.getTime()) / 86400000);
        return Math.floor((diffDays + offset) / 7);
    }

    getDateForWeekCell(year: number, weekIndex: number, weekdayIndex: number) {
        const yearStart = new Date(year, 0, 1);
        const offset = (yearStart.getDay() + 6) % 7;
        const cellDayOffset = weekIndex * 7 + weekdayIndex - offset;
        const cellDate = new Date(year, 0, 1);
        cellDate.setDate(cellDate.getDate() + cellDayOffset);
        return cellDate;
    }

    getHeatmapLayoutMetrics(containerWidth: number) {
        const labelWidth = 36;
        const minCellSize = 10;
        const minGap = 2;
        const usableWidth = Math.max(620, containerWidth - labelWidth - 16);

        let cellSize = Math.floor((usableWidth - minGap * 52) / 53);
        cellSize = Math.max(minCellSize, cellSize);

        let gap = (usableWidth - cellSize * 53) / 52;
        gap = Math.max(minGap, gap);

        return {
            cellSize,
            gap,
            labelWidth,
            monthHeaderHeight: 22
        };
    }

    getDateCount(dailyCounts: Map<string, number>, date: Date | null) {
        if (!date) {
            return 0;
        }
        return dailyCounts.get(this.formatDate(date)) ?? 0;
    }

    getHeatmapColor(count: number, maxCount: number) {
        if (count <= 0 || maxCount <= 0) {
            return 'var(--background-modifier-border)';
        }

        const ratio = count / maxCount;
        if (ratio >= 0.85) return 'rgba(15, 118, 110, 0.95)';
        if (ratio >= 0.6) return 'rgba(20, 184, 166, 0.85)';
        if (ratio >= 0.35) return 'rgba(45, 212, 191, 0.7)';
        if (ratio >= 0.15) return 'rgba(153, 246, 228, 0.7)';
        return 'rgba(204, 251, 241, 0.7)';
    }

    async getCurrentMonthWordCount(): Promise<number> {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

        let total = 0;
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            total += await this.getWordCountForDate(dateStr);
        }

        return total;
    }

    async getTodayWordCount(): Promise<number> {
        return this.getWordCountForDate(this.formatDate(new Date()));
    }

    async getTotalWordCount(): Promise<number> {
        let total = 0;
        for (const file of this.getDiaryFiles()) {
            total += this.countWords(await this.app.vault.read(file));
        }
        return total;
    }

    normalizeTag(tag: string) {
        const trimmed = tag.trim();
        if (!trimmed) return '';
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    }

    getTagLabel(tag: string) {
        return this.normalizeTag(tag).replace(/^#/, '');
    }

    extractTags(text: string): string[] {
        const matches = text.match(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu) ?? [];
        const tags = matches
            .map((match) => match.trim())
            .map((match) => this.normalizeTag(match))
            .filter(Boolean);

        return Array.from(new Set(tags));
    }

    getTagsForFile(file: TFile): string[] {
        const cache = this.app.metadataCache.getFileCache(file);
        const tagSet = new Set<string>();

        cache?.tags?.forEach((tagInfo) => {
            const normalized = this.normalizeTag(tagInfo.tag);
            if (normalized) {
                tagSet.add(normalized);
            }
        });

        const frontmatterTags = cache?.frontmatter?.tags;
        if (Array.isArray(frontmatterTags)) {
            frontmatterTags.forEach((tag) => {
                if (typeof tag === 'string') {
                    const normalized = this.normalizeTag(tag);
                    if (normalized) {
                        tagSet.add(normalized);
                    }
                }
            });
        } else if (typeof frontmatterTags === 'string') {
            frontmatterTags
                .split(/[,\s]+/)
                .map((tag) => this.normalizeTag(tag))
                .filter(Boolean)
                .forEach((tag) => tagSet.add(tag));
        }

        return Array.from(tagSet);
    }

    async getAvailableTags(): Promise<string[]> {
        const tagCounts = new Map<string, number>();

        for (const file of this.getDiaryFiles()) {
            this.getTagsForFile(file).forEach((tag) => {
                tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            });
        }

        return Array.from(tagCounts.entries())
            .sort((a, b) => {
                if (b[1] !== a[1]) {
                    return b[1] - a[1];
                }
                return a[0].localeCompare(b[0], 'zh-Hans-CN');
            })
            .map(([tag]) => tag);
    }

    async getLastTagOccurrence(tag: string): Promise<{ lastDate: string | null; daysSince: number | null }> {
        const normalizedTag = this.normalizeTag(tag);
        if (!normalizedTag) {
            return { lastDate: null, daysSince: null };
        }

        const diaryFiles = this.getDiaryFiles().slice().sort((a, b) => b.basename.localeCompare(a.basename));

        for (const file of diaryFiles) {
            const tags = this.getTagsForFile(file);
            if (!tags.includes(normalizedTag)) {
                continue;
            }

            const [year, month, day] = file.basename.split('-').map(Number);
            const lastDate = new Date(year, month - 1, day);
            const today = new Date();
            const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const diffMs = startOfToday.getTime() - lastDate.getTime();
            const daysSince = Math.floor(diffMs / 86400000);

            return {
                lastDate: file.basename,
                daysSince
            };
        }

        return { lastDate: null, daysSince: null };
    }

    updateStats(counts: number[], fullDates: string[]) {
        const container = this.containerEl.children[1] as HTMLElement;
        let statsDiv = container.querySelector('.word-count-stats') as HTMLElement | null;

        if (!statsDiv) {
            statsDiv = container.createDiv('word-count-stats');
        }

        statsDiv.empty();
        statsDiv.style.cssText = `
            padding: 16px;
            background-color: var(--background-secondary);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
            margin-bottom: 10px;
        `;

        const max = counts.length > 0 ? Math.max(...counts) : 0;
        const maxIndex = counts.indexOf(max);
        const maxDate = maxIndex >= 0 ? fullDates[maxIndex] : '';

        Promise.all([
            this.getTotalDiaryCount(),
            this.getTotalWordCount(),
            this.getCurrentMonthWordCount(),
            this.getTodayWordCount(),
            this.getAvailableTags()
        ]).then(async ([totalDiaryCount, totalWordCount, monthTotal, todayWordCount, availableTags]) => {
            let trackedTag = this.normalizeTag(this.plugin.settings.trackedTag);
            if (trackedTag && !availableTags.includes(trackedTag)) {
                trackedTag = '';
            }
            if (!trackedTag && availableTags.length > 0) {
                trackedTag = availableTags[0];
            }
            if (trackedTag !== this.plugin.settings.trackedTag) {
                this.plugin.settings.trackedTag = trackedTag;
                await this.plugin.saveSettings();
            }

            const tagSummary = trackedTag
                ? await this.getLastTagOccurrence(trackedTag)
                : { lastDate: null, daysSince: null };

            this.createPanelHeader(statsDiv!, '📈 统计信息', (actionsEl) => {
                const refreshBtn = actionsEl.createEl('button', {
                    text: '🔄 刷新全部',
                    cls: 'mod-cta'
                });
                refreshBtn.style.cssText = this.getButtonStyle();
                refreshBtn.setAttribute('title', '刷新全部信息');
                refreshBtn.addEventListener('click', () => {
                    this.refreshAllCharts();
                });
            });

            const statsGrid = statsDiv!.createDiv('stats-grid');
            statsGrid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
                gap: 12px;
                margin-top: 10px;
            `;

            const statItems = [
                { label: '📘 总日记数', value: totalDiaryCount.toString() },
                { label: '✍️ 总计字数', value: totalWordCount.toLocaleString() },
                { label: '🗓️ 今日字数', value: todayWordCount.toLocaleString() },
                { label: '📆 本月累计', value: monthTotal.toLocaleString() }
            ];

            statItems.forEach((stat) => {
                const statItem = this.createStatsCard(statsGrid);
                statItem.createDiv('stat-label').setText(stat.label);
                const valueEl = statItem.createDiv('stat-value');
                valueEl.setText(stat.value);
                valueEl.style.cssText = this.getStatValueStyle();
            });

            if (availableTags.length > 0) {
                const statItem = this.createStatsCard(statsGrid);
                const labelRow = statItem.createDiv('stat-label-row');
                labelRow.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    flex-wrap: wrap;
                `;
                labelRow.createSpan({ text: '🏷️ 距离上次' });

                const tagSelect = labelRow.createEl('select');
                tagSelect.style.cssText = `
                    ${this.getControlStyle()}
                    max-width: 140px;
                    padding: 2px 8px;
                    font-size: 12px;
                `;
                availableTags.forEach((tag) => {
                    const option = tagSelect.createEl('option', {
                        text: this.getTagLabel(tag),
                        value: tag
                    });
                    option.selected = tag === trackedTag;
                });
                tagSelect.addEventListener('change', async (event) => {
                    this.plugin.settings.trackedTag = this.normalizeTag((event.target as HTMLSelectElement).value);
                    await this.plugin.saveSettings();
                    this.updateStats(counts, fullDates);
                });

                const valueEl = statItem.createDiv('stat-value');
                valueEl.setText(tagSummary.daysSince === null ? '暂无记录' : `已经 ${tagSummary.daysSince} 天`);
                valueEl.style.cssText = this.getStatValueStyle();

                if (tagSummary.lastDate) {
                    const desc = statItem.createDiv('stat-desc');
                    desc.setText(`上次出现：${tagSummary.lastDate}`);
                    desc.style.cssText = `
                        margin-top: 4px;
                        color: var(--text-muted);
                        font-size: 0.85em;
                    `;
                }
            }

            const maxDayDiv = statsDiv!.createDiv('max-day-item');
            maxDayDiv.style.cssText = `
                margin-top: 16px;
                padding: 16px;
                background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-primary) 100%);
                border-radius: 8px;
                border: 1px solid var(--background-modifier-border);
                transition: all 0.2s ease;
            `;
            maxDayDiv.addEventListener('mouseenter', () => {
                maxDayDiv.style.transform = 'translateY(-2px)';
                maxDayDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                maxDayDiv.style.borderColor = 'var(--interactive-accent)';
            });
            maxDayDiv.addEventListener('mouseleave', () => {
                maxDayDiv.style.transform = 'translateY(0)';
                maxDayDiv.style.boxShadow = 'none';
                maxDayDiv.style.borderColor = 'var(--background-modifier-border)';
            });

            const maxLabelDiv = maxDayDiv.createDiv('max-label');
            maxLabelDiv.setText('🏅 近期最高单日');
            maxLabelDiv.style.cssText = `
                font-size: 0.9em;
                color: var(--text-muted);
                margin-bottom: 8px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            `;

            const maxValueDiv = maxDayDiv.createDiv('max-value-container');
            maxValueDiv.style.cssText = `
                display: flex;
                align-items: baseline;
                gap: 15px;
                flex-wrap: wrap;
            `;

            const maxValue = maxValueDiv.createSpan();
            maxValue.setText(`${max.toLocaleString()} 字`);
            maxValue.style.cssText = `
                font-size: 1.8em;
                font-weight: bold;
                color: var(--text-accent);
            `;

            if (maxDate) {
                const maxLink = maxValueDiv.createEl('a', {
                    text: `📅 ${maxDate}`,
                    cls: 'max-day-link'
                });
                maxLink.style.cssText = `
                    color: var(--text-muted);
                    text-decoration: none;
                    cursor: pointer;
                    font-size: 1em;
                    padding: 4px 8px;
                    border-radius: 4px;
                    background-color: var(--background-modifier-hover);
                `;
                maxLink.addEventListener('mouseenter', () => {
                    maxLink.style.color = 'var(--text-accent)';
                    maxLink.style.backgroundColor = 'var(--background-modifier-active-hover)';
                });
                maxLink.addEventListener('mouseleave', () => {
                    maxLink.style.color = 'var(--text-muted)';
                    maxLink.style.backgroundColor = 'var(--background-modifier-hover)';
                });
                maxLink.addEventListener('click', async () => {
                    await this.openDiaryFile(maxDate);
                });
            }
        }).catch((error) => {
            console.error('更新统计信息时出错:', error);
        });
    }

    async loadRandomMemories() {
        if (!this.memoryContainer) return;

        this.memoryContainer.empty();
        for (let i = 0; i < 3; i++) {
            const loadingItem = this.memoryContainer.createDiv('memory-item');
            loadingItem.style.cssText = `
                padding: 12px 16px;
                background-color: var(--background-primary);
                border-radius: 6px;
                color: var(--text-muted);
                border-left: 4px solid var(--interactive-accent);
            `;
            loadingItem.setText('加载中...');
        }

        const memories = await this.getRandomMemories(3);
        this.memoryContainer.empty();

        if (memories.length === 0) {
            const emptyItem = this.memoryContainer.createDiv('memory-item');
            emptyItem.style.cssText = `
                padding: 12px 16px;
                background-color: var(--background-primary);
                border-radius: 6px;
                color: var(--text-muted);
                border-left: 4px solid var(--interactive-accent);
            `;
            emptyItem.setText('暂无日记记录，开始写日记吧！');
            return;
        }

        memories.forEach((memory) => {
            const memoryItem = this.memoryContainer!.createDiv('memory-item');
            memoryItem.style.cssText = `
                padding: 12px 16px;
                background-color: var(--background-primary);
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                border-left: 4px solid var(--interactive-accent);
            `;

            const memoryText = memoryItem.createDiv('memory-text');
            memoryText.setText(memory.text);
            memoryText.style.cssText = `
                font-size: 1em;
                line-height: 1.6;
                color: var(--text-normal);
                margin-bottom: 6px;
            `;

            const memoryDate = memoryItem.createDiv('memory-date');
            memoryDate.setText(`📅 ${memory.date}`);
            memoryDate.style.cssText = `
                font-size: 0.85em;
                color: var(--text-muted);
            `;

            memoryItem.addEventListener('mouseenter', () => {
                memoryItem.style.backgroundColor = 'var(--background-secondary)';
                memoryItem.style.transform = 'translateX(4px)';
            });
            memoryItem.addEventListener('mouseleave', () => {
                memoryItem.style.backgroundColor = 'var(--background-primary)';
                memoryItem.style.transform = 'translateX(0)';
            });
            memoryItem.addEventListener('click', () => {
                this.openDiaryFile(memory.date);
            });
        });
    }

    escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async getRandomMemories(count: number): Promise<Array<{ text: string; date: string }>> {
        const diaryFiles = this.getDiaryFiles();
        if (diaryFiles.length === 0) {
            return [];
        }

        const allLines: Array<{ text: string; date: string }> = [];

        for (const file of diaryFiles) {
            const content = await this.app.vault.read(file);
            const lines = this.extractMemoryCandidateLines(content);

            lines.forEach((line) => {
                allLines.push({
                    text: line,
                    date: file.basename
                });
            });
        }

        if (allLines.length === 0) {
            return [];
        }

        const selected = new Set<number>();
        const maxCount = Math.min(count, allLines.length);
        while (selected.size < maxCount) {
            selected.add(Math.floor(Math.random() * allLines.length));
        }

        return Array.from(selected).map((index) => allLines[index]);
    }

    getDiaryFiles(): TFile[] {
        const folderPath = `${this.plugin.settings.diaryFolder}/`;
        return this.app.vault.getFiles().filter((file) => {
            return file.path.startsWith(folderPath)
                && file.extension === 'md'
                && /^\d{4}-\d{2}-\d{2}$/.test(file.basename);
        });
    }

    async getTotalDiaryCount(): Promise<number> {
        return this.getDiaryFiles().length;
    }
}

export default class DiaryNavigatorPlugin extends Plugin {
    settings: DailyWordCountSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_DIARY_NAVIGATOR,
            (leaf) => new DiaryNavigatorView(leaf, this)
        );

        this.addCommand({
            id: 'open-diary-navigator',
            name: '打开日记导航器',
            callback: () => {
                this.activateView();
            }
        });

        this.addRibbonIcon('line-chart', 'Diary Navigator', () => {
            this.activateView();
        });

        this.addSettingTab(new DiaryNavigatorSettingTab(this.app, this));
        console.log('Diary Navigator 插件已加载');
    }

    onunload() {
        console.log('Diary Navigator 插件已卸载');
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_DIARY_NAVIGATOR)[0];

        if (!leaf) {
            const rightLeaf = workspace.getRightLeaf(false);
            if (rightLeaf) {
                await rightLeaf.setViewState({
                    type: VIEW_TYPE_DIARY_NAVIGATOR,
                    active: true
                });
                leaf = rightLeaf;
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class DiaryNavigatorSettingTab extends PluginSettingTab {
    plugin: DiaryNavigatorPlugin;

    constructor(app: App, plugin: DiaryNavigatorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: '📊 日记字数统计设置' });

        new Setting(containerEl)
            .setName('日记文件夹')
            .setDesc('存放日记文件的文件夹名称')
            .addText((text) => text
                .setPlaceholder('日记')
                .setValue(this.plugin.settings.diaryFolder)
                .onChange(async (value) => {
                    this.plugin.settings.diaryFolder = value.trim() || '日记';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('日期格式')
            .setDesc('日记文件的命名格式（暂不支持修改）')
            .addText((text) => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .setDisabled(true));

        new Setting(containerEl)
            .setName('追踪标签')
            .setDesc('用于统计“距离上次某标签已经多少天”，支持填写 #标签')
            .addText((text) => text
                .setPlaceholder('#复盘')
                .setValue(this.plugin.settings.trackedTag)
                .onChange(async (value) => {
                    this.plugin.settings.trackedTag = value.trim();
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('div', {
            text: '提示：折线图可直接打开对应日期日记，柱状图可直接打开对应月份总结文件，热力图与历史上的今天也都支持点击跳转。',
            cls: 'setting-item-description'
        }).style.cssText = 'margin-top: 20px; padding: 10px; background: var(--background-secondary); border-radius: 5px;';
    }
}
