import { App, Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { Chart, registerables } from 'chart.js';

// 注册 Chart.js 组件
Chart.register(...registerables);

interface DailyWordCountSettings {
    diaryFolder: string;
    dateFormat: string;
}

const DEFAULT_SETTINGS: DailyWordCountSettings = {
    diaryFolder: '日记',
    dateFormat: 'YYYY-MM-DD'
};

const VIEW_TYPE_DIARY_NAVIGATOR = 'word-count-chart-view';

// 自定义视图类
class DiaryNavigatorView extends ItemView {
    plugin: DiaryNavigatorPlugin;
    dailyChart: Chart | null = null;
    monthlyChart: Chart | null = null;
    currentDays: number = 30;
    dailyFullDates: string[] = [];
    monthlyFullMonths: string[] = [];
    daysSelect: HTMLSelectElement | null = null;
    memoryContainer: HTMLElement | null = null;
    lastYearContainer: HTMLElement | null = null;

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
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('word-count-chart-view');
        
        // 创建统计信息区域
        const statsDiv = container.createDiv('word-count-stats');
        
        // 创建双图表容器
        const chartsWrapper = container.createDiv('charts-wrapper');
        chartsWrapper.style.cssText = `
            display: flex;
            gap: 20px;
            margin-top: 20px;
            flex-wrap: wrap;
        `;
        
        // 左侧：每日字数折线图
        const dailyChartSection = chartsWrapper.createDiv('daily-chart-section');
        dailyChartSection.style.cssText = `
            flex: 1;
            min-width: 400px;
            padding: 16px;
            background-color: var(--background-secondary);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
        `;
        
        // 图表标题和控制按钮在同一行
        const dailyHeader = dailyChartSection.createDiv('daily-header');
        dailyHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;
        
        dailyHeader.createEl('h3', { text: '📈 每日字数趋势' });
        
        // 控制按钮组
        const controlsGroup = dailyHeader.createDiv('controls-group');
        controlsGroup.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: center;
        `;
        
        // 刷新按钮
        const refreshBtn = controlsGroup.createEl('button', {
            text: '🔄',
            cls: 'mod-cta'
        });
        refreshBtn.style.cssText = `
            padding: 4px 8px;
            font-size: 14px;
        `;
        refreshBtn.setAttribute('title', '刷新数据');
        refreshBtn.addEventListener('click', () => {
            this.refreshAllCharts();
        });
        
        // 天数选择
        this.daysSelect = controlsGroup.createEl('select');
        this.daysSelect.style.cssText = `
            padding: 4px 8px;
            font-size: 14px;
            border-radius: 4px;
            background-color: var(--background-modifier-form-field);
            border: 1px solid var(--background-modifier-border);
        `;
        [7, 14, 30, 60, 90].forEach(days => {
            const option = this.daysSelect!.createEl('option', { 
                text: `${days}天`,
                value: days.toString()
            });
            if (days === 30) option.selected = true;
        });
        
        this.daysSelect.addEventListener('change', (e) => {
            this.currentDays = parseInt((e.target as HTMLSelectElement).value);
            this.refreshDailyChart();
        });
        
        const dailyChartContainer = dailyChartSection.createDiv('chart-container');
        dailyChartContainer.style.cssText = `
            height: 300px;
            margin-top: 10px;
        `;
        const dailyCanvas = dailyChartContainer.createEl('canvas');
        dailyCanvas.id = 'daily-word-chart';
        
        // 右侧：月度平均柱状图
        const monthlyChartSection = chartsWrapper.createDiv('monthly-chart-section');
        monthlyChartSection.style.cssText = `
            flex: 1;
            min-width: 400px;
            padding: 16px;
            background-color: var(--background-secondary);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
        `;
        
        monthlyChartSection.createEl('h3', { text: '📊 月度平均字数' });
        const monthlyChartContainer = monthlyChartSection.createDiv('chart-container');
        monthlyChartContainer.style.cssText = `
            height: 300px;
            margin-top: 10px;
        `;
        const monthlyCanvas = monthlyChartContainer.createEl('canvas');
        monthlyCanvas.id = 'monthly-avg-chart';
        
        // 创建回忆区域（两栏布局）
        const memoryWrapper = container.createDiv('memory-wrapper');
        memoryWrapper.style.cssText = `
            display: flex;
            gap: 20px;
            margin-top: 20px;
            flex-wrap: wrap;
        `;
        
        // 左侧：回忆漫游（三条随机）
        const memorySection = memoryWrapper.createDiv('memory-section');
        memorySection.style.cssText = `
            flex: 1;
            min-width: 350px;
            padding: 16px;
            background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
        `;
        
        const memoryHeader = memorySection.createDiv('memory-header');
        memoryHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;
        
        memoryHeader.createEl('h3', { text: '📜 回忆漫游' });
        
        const refreshMemoryBtn = memoryHeader.createEl('button', {
            text: '🔄 换一批',
            cls: 'mod-cta'
        });
        refreshMemoryBtn.style.cssText = `
            padding: 4px 12px;
            font-size: 14px;
        `;
        
        this.memoryContainer = memorySection.createDiv('memory-container');
        this.memoryContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;
        
        // 右侧：去年今日
        const lastYearSection = memoryWrapper.createDiv('last-year-section');
        lastYearSection.style.cssText = `
            flex: 1;
            min-width: 350px;
            padding: 16px;
            background: linear-gradient(135deg, var(--background-primary) 0%, var(--background-secondary) 100%);
            border-radius: 8px;
            border: 1px solid var(--background-modifier-border);
        `;
        
        const lastYearHeader = lastYearSection.createDiv('last-year-header');
        lastYearHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;
        
        const today = new Date();
        const lastYearDate = new Date(today);
        lastYearDate.setFullYear(today.getFullYear() - 1);
        const lastYearStr = this.formatDate(lastYearDate);
        
        lastYearHeader.createEl('h3', { text: `📅 去年今日 (${lastYearStr})` });
        
        const openLastYearBtn = lastYearHeader.createEl('button', {
            text: '📝 打开',
            cls: 'mod-cta'
        });
        openLastYearBtn.style.cssText = `
            padding: 4px 12px;
            font-size: 14px;
        `;
        openLastYearBtn.addEventListener('click', () => {
            this.openDiaryFile(lastYearStr);
        });
        
        this.lastYearContainer = lastYearSection.createDiv('last-year-container');
        this.lastYearContainer.style.cssText = `
            padding: 12px;
            background-color: var(--background-primary);
            border-radius: 6px;
            min-height: 200px;
            max-height: 400px;
            overflow-y: auto;
        `;
        
        // 加载随机回忆
        const loadRandomMemories = async () => {
            if (!this.memoryContainer) return;
            
            this.memoryContainer.empty();
            
            // 显示加载中
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
                
                // 显示文字和日期
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
                
                // 悬停效果
                memoryItem.addEventListener('mouseenter', () => {
                    memoryItem.style.backgroundColor = 'var(--background-secondary)';
                    memoryItem.style.transform = 'translateX(4px)';
                });
                memoryItem.addEventListener('mouseleave', () => {
                    memoryItem.style.backgroundColor = 'var(--background-primary)';
                    memoryItem.style.transform = 'translateX(0)';
                });
                
                // 点击跳转 - 使用闭包保存正确的日期
                const dateToOpen = memory.date;
                memoryItem.addEventListener('click', () => {
                    this.openDiaryFile(dateToOpen);
                });
            });
        };
        
        // 加载去年今日
        const loadLastYearDiary = async () => {
            if (!this.lastYearContainer) return;
            
            this.lastYearContainer.empty();
            
            const loadingItem = this.lastYearContainer.createDiv('loading-item');
            loadingItem.setText('加载中...');
            loadingItem.style.cssText = `
                color: var(--text-muted);
                text-align: center;
                padding: 20px;
            `;
            
            const lastYearContent = await this.getLastYearDiary();
            
            this.lastYearContainer.empty();
            
            if (!lastYearContent) {
                const emptyItem = this.lastYearContainer.createDiv('empty-item');
                emptyItem.setText('去年的今天没有写日记');
                emptyItem.style.cssText = `
                    color: var(--text-muted);
                    text-align: center;
                    padding: 20px;
                `;
                return;
            }
            
            // 显示日记内容预览
            const previewDiv = this.lastYearContainer.createDiv('preview-content');
            previewDiv.style.cssText = `
                line-height: 1.8;
                color: var(--text-normal);
                cursor: pointer;
            `;
            
            // 截取前500字作为预览
            const previewText = lastYearContent.length > 500 
                ? lastYearContent.substring(0, 500) + '...' 
                : lastYearContent;
            
            // 简单的 Markdown 渲染（转义 HTML）
            const escapedText = this.escapeHtml(previewText);
            previewDiv.innerHTML = escapedText.replace(/\n/g, '<br>');
            
            // 字数统计
            const wordCount = this.countWords(lastYearContent);
            const wordCountDiv = this.lastYearContainer.createDiv('word-count');
            wordCountDiv.style.cssText = `
                margin-top: 12px;
                padding-top: 12px;
                border-top: 1px solid var(--background-modifier-border);
                font-size: 0.9em;
                color: var(--text-muted);
            `;
            wordCountDiv.setText(`📝 共 ${wordCount.toLocaleString()} 字`);
            
            // 点击预览区域跳转
            previewDiv.addEventListener('click', () => {
                const today = new Date();
                const lastYearDate = new Date(today);
                lastYearDate.setFullYear(today.getFullYear() - 1);
                const lastYearStr = this.formatDate(lastYearDate);
                this.openDiaryFile(lastYearStr);
            });
            
            previewDiv.addEventListener('mouseenter', () => {
                previewDiv.style.backgroundColor = 'var(--background-secondary)';
            });
            previewDiv.addEventListener('mouseleave', () => {
                previewDiv.style.backgroundColor = 'transparent';
            });
        };
        
        refreshMemoryBtn.addEventListener('click', loadRandomMemories);
        
        // 加载提示
        const loadingDiv = container.createDiv('loading-indicator');
        loadingDiv.setText('加载数据中...');
        loadingDiv.style.cssText = 'text-align: center; padding: 20px; color: var(--text-muted);';
        
        // 初始化图表和回忆
        setTimeout(async () => {
            if (loadingDiv) loadingDiv.remove();
            await this.refreshAllCharts();
            await loadRandomMemories();
            await loadLastYearDiary();
        }, 100);
    }

    escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async getLastYearDiary(): Promise<string | null> {
        const today = new Date();
        const lastYearDate = new Date(today);
        lastYearDate.setFullYear(today.getFullYear() - 1);
        const lastYearStr = this.formatDate(lastYearDate);
        
        const folderPath = this.plugin.settings.diaryFolder;
        const filePath = `${folderPath}/${lastYearStr}.md`;
        
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file && file instanceof TFile) {
                const content = await this.app.vault.read(file);
                // 移除 YAML frontmatter
                const contentWithoutFrontmatter = content.replace(/^---[\s\S]*?---\n?/, '').trim();
                return contentWithoutFrontmatter;
            }
        } catch (error) {
            console.error('读取去年今日日记时出错:', error);
        }
        
        return null;
    }

    async getRandomMemories(count: number): Promise<{ text: string; date: string }[]> {
        const folderPath = this.plugin.settings.diaryFolder;
        const memories: { text: string; date: string }[] = [];
        
        try {
            const files = this.app.vault.getFiles();
            const diaryFiles: TFile[] = [];
            
            // 收集所有日记文件
            for (const file of files) {
                if (file.path.startsWith(folderPath + '/') && file.extension === 'md') {
                    const fileName = file.basename;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(fileName)) {
                        diaryFiles.push(file);
                    }
                }
            }
            
            if (diaryFiles.length === 0) {
                return [];
            }
            
            // 收集所有有效行
            const allLines: { text: string; date: string }[] = [];
            
            for (const file of diaryFiles) {
                const content = await this.app.vault.read(file);
                const dateStr = file.basename;
                
                // 解析内容，提取有效行
                const lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => {
                        // 过滤掉空行、标题、代码块、frontmatter等
                        return line.length > 0 &&
                               !line.startsWith('#') &&
                               !line.startsWith('---') &&
                               !line.startsWith('```') &&
                               !line.startsWith('- [ ]') &&
                               !line.startsWith('- [x]') &&
                               !line.match(/^[0-9]+\./) &&
                               !line.startsWith('>') &&
                               line.length > 10;
                    });
                
                for (const line of lines) {
                    allLines.push({
                        text: line,
                        date: dateStr
                    });
                }
            }
            
            if (allLines.length === 0) {
                return [];
            }
            
            // 随机选择 count 条，不重复
            const selected = new Set<number>();
            const maxCount = Math.min(count, allLines.length);
            
            while (selected.size < maxCount) {
                const randomIndex = Math.floor(Math.random() * allLines.length);
                selected.add(randomIndex);
            }
            
            const selectedIndices = Array.from(selected);
            for (const index of selectedIndices) {
                memories.push(allLines[index]);
            }
            
            return memories;
            
        } catch (error) {
            console.error('获取随机回忆时出错:', error);
            return [];
        }
    }

    async refreshAllCharts() {
        if (this.daysSelect) {
            this.daysSelect.value = this.currentDays.toString();
        }
        await this.refreshDailyChart();
        await this.refreshMonthlyChart();
    }

    async refreshDailyChart() {
        const canvas = document.getElementById('daily-word-chart') as HTMLCanvasElement;
        if (!canvas) return;
        
        try {
            const data = await this.getDailyWordCountData(this.currentDays);
            this.dailyFullDates = data.fullDates;
            
            if (this.dailyChart) {
                this.dailyChart.destroy();
            }
            
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
                    onClick: (event, elements) => {
                        if (elements && elements.length > 0) {
                            const index = elements[0].index;
                            const dateStr = this.dailyFullDates[index];
                            this.openDiaryFile(dateStr);
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed.y ?? 0;
                                    return `字数: ${value.toLocaleString()}`;
                                },
                                title: (context) => {
                                    const index = context[0].dataIndex;
                                    return this.dailyFullDates[index];
                                }
                            }
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
                                callback: (value) => {
                                    return Number(value).toLocaleString();
                                }
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: '日期'
                            }
                        }
                    }
                }
            });
            
            this.updateStats(data.counts, data.labels, data.fullDates);
            
        } catch (error) {
            console.error('刷新每日图表时出错:', error);
        }
    }

    async refreshMonthlyChart() {
        const canvas = document.getElementById('monthly-avg-chart') as HTMLCanvasElement;
        if (!canvas) return;
        
        try {
            const data = await this.getMonthlyAvgData();
            this.monthlyFullMonths = data.fullMonths;
            
            if (this.monthlyChart) {
                this.monthlyChart.destroy();
            }
            
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
                    onClick: (event, elements) => {
                        if (elements && elements.length > 0) {
                            const index = elements[0].index;
                            const monthStr = this.monthlyFullMonths[index];
                            this.openMonthlySummary(monthStr);
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = context.parsed.y ?? 0;
                                    return `月均字数: ${Math.round(value).toLocaleString()}`;
                                },
                                title: (context) => {
                                    const index = context[0].dataIndex;
                                    return `${this.monthlyFullMonths[index]} 月均`;
                                }
                            }
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
                                callback: (value) => {
                                    return Number(value).toLocaleString();
                                }
                            }
                        },
                        x: {
                            title: {
                                display: true,
                                text: '月份'
                            }
                        }
                    }
                }
            });
            
        } catch (error) {
            console.error('刷新月度图表时出错:', error);
        }
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
            
            const wordCount = await this.getWordCountForDate(dateStr);
            counts.push(wordCount);
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
            const [year, monthNum] = month.split('-');
            labels.push(`${monthNum}月`);
            fullMonths.push(month);
            
            const avg = await this.calculateMonthlyAverage(month);
            avgs.push(avg);
        }
        
        return { labels, avgs, fullMonths };
    }

    async getAllMonths(): Promise<string[]> {
        const folderPath = this.plugin.settings.diaryFolder;
        const months = new Set<string>();
        
        try {
            const files = this.app.vault.getFiles();
            
            for (const file of files) {
                if (file.path.startsWith(folderPath + '/') && file.extension === 'md') {
                    const fileName = file.basename;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(fileName)) {
                        const month = fileName.slice(0, 7);
                        months.add(month);
                    }
                }
            }
        } catch (error) {
            console.error('获取月份列表时出错:', error);
        }
        
        return Array.from(months);
    }

    async calculateMonthlyAverage(month: string): Promise<number> {
        const folderPath = this.plugin.settings.diaryFolder;
        const [year, monthNum] = month.split('-');
        const daysInMonth = new Date(parseInt(year), parseInt(monthNum), 0).getDate();
        
        let totalWords = 0;
        let daysWithContent = 0;
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${monthNum}-${String(day).padStart(2, '0')}`;
            const filePath = `${folderPath}/${dateStr}.md`;
            
            try {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file && file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    const wordCount = this.countWords(content);
                    if (wordCount > 0) {
                        totalWords += wordCount;
                        daysWithContent++;
                    }
                }
            } catch (error) {
                // 文件不存在，跳过
            }
        }
        
        return daysWithContent > 0 ? totalWords / daysWithContent : 0;
    }

    async openDiaryFile(dateStr: string) {
        const folderPath = this.plugin.settings.diaryFolder;
        const filePath = `${folderPath}/${dateStr}.md`;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file && file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }

    async openMonthlySummary(monthStr: string) {
        const folderPath = this.plugin.settings.diaryFolder;
        const filePath = `${folderPath}/${monthStr}.md`;
        
        let file = this.app.vault.getAbstractFileByPath(filePath);
        
        if (!file) {
            file = await this.app.vault.create(filePath, '');
        }
        
        if (file && file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }

    async getWordCountForDate(dateStr: string): Promise<number> {
        const folderPath = this.plugin.settings.diaryFolder;
        const fileName = `${dateStr}.md`;
        const filePath = `${folderPath}/${fileName}`;
        
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file && file instanceof TFile) {
                const content = await this.app.vault.read(file);
                return this.countWords(content);
            }
        } catch (error) {
            // 文件不存在，返回0
        }
        
        return 0;
    }

    countWords(text: string): number {
        text = text.replace(/^---[\s\S]*?---\n?/, '');
        text = text.replace(/```[\s\S]*?```/g, '');
        text = text.replace(/`[^`]*`/g, '');
        text = text.replace(/!\[.*?\]\(.*?\)/g, '');
        text = text.replace(/\[.*?\]\(.*?\)/g, '');
        text = text.replace(/\[\[.*?\]\]/g, '');
        text = text.replace(/[#*`~\[\]()_>|-]/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();
        
        const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        const englishWords = text.match(/[a-zA-Z0-9]+(?:[''-][a-zA-Z0-9]+)?/g) || [];
        
        return chineseChars.length + englishWords.length;
    }

    formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async getCurrentMonthWordCount(): Promise<number> {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        let total = 0;
        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
        
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const wordCount = await this.getWordCountForDate(dateStr);
            total += wordCount;
        }
        
        return total;
    }

    updateStats(counts: number[], labels: string[], fullDates: string[]) {
        const container = this.containerEl.children[1];
        let statsDiv = container.querySelector('.word-count-stats') as HTMLElement;
        
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
        
        const total = counts.reduce((sum, count) => sum + count, 0);
        const max = counts.length > 0 ? Math.max(...counts) : 0;
        const maxIndex = counts.indexOf(max);
        const maxDate = maxIndex >= 0 ? fullDates[maxIndex] : '';
        
        Promise.all([
            this.getTotalDiaryCount(),
            this.getCurrentMonthWordCount()
        ]).then(([totalDiaryCount, monthTotal]) => {
            statsDiv.createEl('h3', { text: '📈 统计信息' });
            
            const statsGrid = statsDiv.createDiv('stats-grid');
            statsGrid.style.cssText = `
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin-top: 10px;
            `;
            
            const stats = [
                { label: '📚 总日记数', value: totalDiaryCount.toString() },
                { label: '✍️ 总计字数', value: total.toLocaleString() },
                { label: '📅 本月累计', value: monthTotal.toLocaleString() }
            ];
            
            stats.forEach(stat => {
                const statItem = statsGrid.createDiv('stat-item');
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
                
                statItem.createDiv('stat-label').setText(stat.label);
                const valueEl = statItem.createDiv('stat-value');
                valueEl.setText(stat.value);
                valueEl.style.cssText = `
                    font-size: 1.4em;
                    font-weight: bold;
                    color: var(--text-accent);
                    margin-top: 5px;
                `;
            });
            
            // 最高单日
            const maxDayDiv = statsDiv.createDiv('max-day-item');
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
            maxLabelDiv.setText('🏆 最高单日');
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
        });
    }

    async getTotalDiaryCount(): Promise<number> {
        const folderPath = this.plugin.settings.diaryFolder;
        
        try {
            const files = this.app.vault.getFiles();
            let count = 0;
            
            for (const file of files) {
                if (file.path.startsWith(folderPath + '/') && file.extension === 'md') {
                    const fileName = file.basename;
                    if (/^\d{4}-\d{2}-\d{2}$/.test(fileName)) {
                        count++;
                    }
                }
            }
            
            return count;
        } catch (error) {
            console.error('获取总日记数时出错:', error);
            return 0;
        }
    }

    async onClose() {
        if (this.dailyChart) {
            this.dailyChart.destroy();
        }
        if (this.monthlyChart) {
            this.monthlyChart.destroy();
        }
    }
}

// 主插件类
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
                    active: true,
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

// 设置选项卡
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
            .addText(text => text
                .setPlaceholder('日记')
                .setValue(this.plugin.settings.diaryFolder)
                .onChange(async (value) => {
                    this.plugin.settings.diaryFolder = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('日期格式')
            .setDesc('日记文件的命名格式（暂不支持修改）')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dateFormat)
                .setDisabled(true));
        
        containerEl.createEl('div', {
            text: '💡 提示：点击折线图上的点可跳转到对应日记；点击柱状图可跳转到对应月份的总结文件（YYYY-MM.md）。',
            cls: 'setting-item-description'
        }).style.cssText = 'margin-top: 20px; padding: 10px; background: var(--background-secondary); border-radius: 5px;';
    }
}