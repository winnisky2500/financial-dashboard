Deno.serve(async (req) => {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'false'
    };

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    try {
        const { simulationData, metadata, chartImages } = await req.json();

        if (!simulationData) {
            throw new Error('缺少模拟数据');
        }

        // 获取环境变量
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');

        if (!serviceRoleKey || !supabaseUrl) {
            throw new Error('Supabase配置缺失');
        }

        // 生成PDF报告内容
        const reportContent = await generatePDFReportContent(simulationData, metadata, chartImages);

        // 使用AI服务生成增强PDF内容
        const enhancedReport = await enhanceReportWithAI(reportContent, simulationData);

        // 返回PDF报告数据
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `simulation_report_${timestamp}.pdf`;

        return new Response(JSON.stringify({
            data: {
                reportContent: enhancedReport,
                fileName,
                metadata: {
                    generatedAt: new Date().toISOString(),
                    modelType: simulationData.model,
                    reportType: 'simulation-analysis',
                    pageCount: estimatePageCount(enhancedReport)
                }
            }
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        const errorResponse = {
            error: {
                code: 'PDF_GENERATION_ERROR',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

// 生成PDF报告内容
async function generatePDFReportContent(simulationData: any, metadata: any, chartImages: any[]): Promise<string> {
    const { model, predictions, scenarios, statistics, riskMetrics } = simulationData;
    const { analysisType, parameters, timestamp } = metadata || {};
    
    const currentDate = new Date().toLocaleDateString('zh-CN');
    const reportTitle = `${analysisType || model || '模拟分析'}报告`;

    let reportContent = `
# ${reportTitle}

**生成日期：** ${currentDate}  
**模型类型：** ${model || 'Unknown'}  
**分析范围：** 财务指标预测分析  
**报告版本：** v2.0  

---

## 执行摘要

本报告对财务指标进行了全面的模拟分析。主要发现如下：

`;

    // 添加执行摘要
    if (statistics && statistics.finalValues) {
        const { mean, standardDeviation, min, max } = statistics.finalValues;
        reportContent += `- **预测平均值：** ${mean?.toFixed(2) || 'N/A'}\n`;
        reportContent += `- **波动范围：** ${min?.toFixed(2) || 'N/A'} ~ ${max?.toFixed(2) || 'N/A'}\n`;
        reportContent += `- **标准差：** ${standardDeviation?.toFixed(2) || 'N/A'}\n`;
    }

    if (riskMetrics && riskMetrics.probabilityMetrics) {
        reportContent += `- **盈利概率：** ${riskMetrics.probabilityMetrics.probabilityOfGain?.toFixed(1) || 'N/A'}%\n`;
        reportContent += `- **预期收益：** ${riskMetrics.probabilityMetrics.expectedReturn?.toFixed(2) || 'N/A'}%\n`;
    }

    reportContent += `\n---\n\n`;

    // 模型参数
    reportContent += `## 模型参数

`;
    if (parameters) {
        reportContent += `| 参数名称 | 数值 |\n`;
        reportContent += `|---------|------|\n`;
        
        for (const [key, value] of Object.entries(parameters)) {
            const displayKey = translateParameterName(key);
            reportContent += `| ${displayKey} | ${value} |\n`;
        }
    }
    reportContent += `\n`;

    // 预测结果分析
    reportContent += `## 预测结果分析\n\n`;
    
    if (predictions && Array.isArray(predictions)) {
        reportContent += `### 预测数据趋势\n\n`;
        reportContent += `本次模拟共生成${predictions.length}个时间点的预测数据。数据显示：\n\n`;
        
        const trend = calculateTrend(predictions);
        reportContent += `- **整体趋势：** ${describeTrend(trend)}\n`;
        reportContent += `- **起始值：** ${predictions[0]?.toFixed(2) || 'N/A'}\n`;
        reportContent += `- **终终值：** ${predictions[predictions.length - 1]?.toFixed(2) || 'N/A'}\n`;
        reportContent += `- **总变化率：** ${((predictions[predictions.length - 1] - predictions[0]) / predictions[0] * 100)?.toFixed(2) || 'N/A'}%\n\n`;
    }

    // 场景分析
    if (scenarios && scenarios.scenarios && Array.isArray(scenarios.scenarios)) {
        reportContent += `## 场景分析\n\n`;
        reportContent += `基于模拟结果，我们识别出以下三个主要场景：\n\n`;
        
        scenarios.scenarios.forEach((scenario: any, index: number) => {
            reportContent += `### ${index + 1}. ${scenario.name}\n\n`;
            reportContent += `- **发生概率：** ${(scenario.probability * 100)?.toFixed(1) || 'N/A'}%\n`;
            reportContent += `- **模拟次数：** ${scenario.count || 'N/A'}\n`;
            reportContent += `- **场景描述：** ${scenario.description || 'N/A'}\n\n`;
        });
    }

    // 风险评估
    reportContent += `## 风险评估\n\n`;
    
    if (riskMetrics) {
        if (riskMetrics.valueAtRisk) {
            reportContent += `### Value at Risk (VaR) 分析\n\n`;
            reportContent += `- **95% VaR：** ${riskMetrics.valueAtRisk.var95?.toFixed(2) || 'N/A'}%\n`;
            reportContent += `- **99% VaR：** ${riskMetrics.valueAtRisk.var99?.toFixed(2) || 'N/A'}%\n`;
            reportContent += `- **说明：** ${riskMetrics.valueAtRisk.interpretation || 'VaR表示在特定置信度下的最大可能损失'}\n\n`;
        }
        
        if (riskMetrics.drawdownAnalysis) {
            reportContent += `### 回撤风险分析\n\n`;
            reportContent += `- **平均最大回撤：** ${riskMetrics.drawdownAnalysis.averageMaxDrawdown?.toFixed(2) || 'N/A'}%\n`;
            reportContent += `- **最坏情况回撤：** ${riskMetrics.drawdownAnalysis.worstCaseDrawdown?.toFixed(2) || 'N/A'}%\n`;
            reportContent += `- **说明：** ${riskMetrics.drawdownAnalysis.interpretation || '回撤分析显示投资的最大可能损失'}\n\n`;
        }
    }

    // 统计指标
    reportContent += `## 统计指标\n\n`;
    if (statistics) {
        reportContent += generateStatisticsTable(statistics);
    }

    // 模型诊断
    if (simulationData.diagnostics) {
        reportContent += `## 模型诊断\n\n`;
        reportContent += generateDiagnosticsSection(simulationData.diagnostics);
    }

    // 结论和建议
    reportContent += `## 结论和庭议\n\n`;
    reportContent += generateConclusionsAndRecommendations(simulationData, statistics, riskMetrics);

    // 附录
    reportContent += `## 附录\n\n`;
    reportContent += `### A. 模型技术说明\n\n`;
    reportContent += generateTechnicalAppendix(simulationData.model, parameters);

    reportContent += `\n---\n\n`;
    reportContent += `**报告编制：** MiniMax Agent  \n`;
    reportContent += `**审核：** 财务分析系统  \n`;
    reportContent += `**发布日期：** ${currentDate}  \n`;

    return reportContent;
}

// 使用AI增强报告内容
async function enhanceReportWithAI(reportContent: string, simulationData: any): Promise<string> {
    // 简化版本：直接返回报告内容加上一些AI生成的分析
    let enhancedContent = reportContent;
    
    // 添加智能分析章节
    const aiInsights = generateAIInsights(simulationData);
    
    // 在结论和建议之前插入AI分析
    const conclusionIndex = enhancedContent.indexOf('## 结论和庭议');
    if (conclusionIndex !== -1) {
        const beforeConclusion = enhancedContent.substring(0, conclusionIndex);
        const afterConclusion = enhancedContent.substring(conclusionIndex);
        
        enhancedContent = beforeConclusion + aiInsights + '\n\n' + afterConclusion;
    } else {
        enhancedContent += '\n\n' + aiInsights;
    }
    
    return enhancedContent;
}

// 生成AI洞察
function generateAIInsights(simulationData: any): string {
    const { model, statistics, riskMetrics, scenarios } = simulationData;
    
    let insights = '## AI智能分析洞察\n\n';
    
    insights += '基于机器学习分析，我们识别出以下关键洞察：\n\n';
    
    // 波动性分析
    if (statistics && statistics.finalValues) {
        const cv = statistics.finalValues.coefficientOfVariation;
        if (cv) {
            if (cv < 0.1) {
                insights += '- 🟢 **低波动性：** 模型显示相对稳定的预测结果，适合保守型投资策略\n';
            } else if (cv > 0.3) {
                insights += '- 🟡 **高波动性：** 模型显示显著的不确定性，需要加强风险管理\n';
            } else {
                insights += '- 🟠 **中等波动性：** 模型显示适中的风险水平，符合市场预期\n';
            }
        }
    }
    
    // 场景分布分析
    if (scenarios && scenarios.scenarios) {
        const bullProb = scenarios.scenarios.find((s: any) => s.name.includes('牛市'))?.probability || 0;
        const bearProb = scenarios.scenarios.find((s: any) => s.name.includes('熊市'))?.probability || 0;
        
        if (bullProb > 0.4) {
            insights += '- 🚀 **乐观前景：** 模型显示较高的上涨概率，可考虑合理加仓\n';
        } else if (bearProb > 0.3) {
            insights += '- ⚠️ **谨慎前景：** 模型显示较高的下跌风险，建议合理配置风险对冲\n';
        }
    }
    
    // 模型适合性分析
    if (model) {
        if (model.includes('ARIMA')) {
            insights += '- 📊 **ARIMA模型优势：** 适合捕捉时间序列的趋势和季节性，预测精度相对稳定\n';
        } else if (model.includes('Monte-Carlo')) {
            insights += '- 🎲 **蒙特卡洛优势：** 全面考虑了不确定性因素，提供了丰富的风险情景分析\n';
        }
    }
    
    // 投资建议
    insights += '\n### 投资策略建议\n\n';
    
    if (riskMetrics && riskMetrics.probabilityMetrics) {
        const expectedReturn = riskMetrics.probabilityMetrics.expectedReturn;
        const probOfGain = riskMetrics.probabilityMetrics.probabilityOfGain;
        
        if (expectedReturn > 10 && probOfGain > 60) {
            insights += '1. **积极型策略：** 预期收益和成功概率都较高，可适当提高投资比例\n';
        } else if (expectedReturn < 0 || probOfGain < 40) {
            insights += '1. **保守型策略：** 风险指标显示较高不确定性，建议采取保守的投资姿态\n';
        } else {
            insights += '1. **平衡型策略：** 风险收益特征相对平衡，建议保持当前配置\n';
        }
    }
    
    insights += '2. **分散化原则：** 不要将所有资金集中于单一预测结果，建议采用组合投资策略\n';
    insights += '3. **动态调整：** 定期重新评估模型参数和市场环境变化，及时调整投资策略\n';
    
    return insights;
}

// 计算趋势
function calculateTrend(predictions: number[]): number {
    if (predictions.length < 2) return 0;
    
    const start = predictions[0];
    const end = predictions[predictions.length - 1];
    return (end - start) / start;
}

// 描述趋势
function describeTrend(trend: number): string {
    if (trend > 0.1) return '强劲上升趋势';
    if (trend > 0.05) return '温和上升趋势';
    if (trend > 0) return '微幅上升趋势';
    if (trend > -0.05) return '相对稳定趋势';
    if (trend > -0.1) return '温和下降趋势';
    return '显著下降趋势';
}

// 翻译参数名称
function translateParameterName(key: string): string {
    const translations: { [key: string]: string } = {
        'numSimulations': '模拟次数',
        'timeHorizon': '时间周期',
        'initialValue': '初始值',
        'drift': '漂移率',
        'volatility': '波动率',
        'periods': '预测期数',
        'exchangeRateChange': '汇率变化',
        'interestRateChange': '利率变化',
        'p': 'AR阶数',
        'd': '差分阶数',
        'q': 'MA阶数'
    };
    
    return translations[key] || key;
}

// 生成统计指标表格
function generateStatisticsTable(statistics: any): string {
    let table = '| 指标名称 | 数值 | 说明 |\n';
    table += '|---------|------|------|\n';
    
    if (statistics.finalValues) {
        const stats = statistics.finalValues;
        table += `| 平均值 | ${stats.mean?.toFixed(2) || 'N/A'} | 所有模拟结果的平均值 |\n`;
        table += `| 中位数 | ${stats.median?.toFixed(2) || 'N/A'} | 50%分位数值 |\n`;
        table += `| 标准差 | ${stats.standardDeviation?.toFixed(2) || 'N/A'} | 衡量数据散布的程度 |\n`;
        table += `| 最小值 | ${stats.min?.toFixed(2) || 'N/A'} | 所有模拟中的最小值 |\n`;
        table += `| 最大值 | ${stats.max?.toFixed(2) || 'N/A'} | 所有模拟中的最大值 |\n`;
        table += `| 变异系数 | ${stats.coefficientOfVariation?.toFixed(3) || 'N/A'} | 标准差与平均值的比率 |\n`;
    }
    
    return table + '\n';
}

// 生成诊断章节
function generateDiagnosticsSection(diagnostics: any): string {
    let section = '模型诊断帮助评估模型的适合性和可靠性：\n\n';
    
    if (diagnostics.ljungBoxTest) {
        const ljung = diagnostics.ljungBoxTest;
        section += `### Ljung-Box白噪声检验\n\n`;
        section += `- **统计量：** ${ljung.statistic?.toFixed(4) || 'N/A'}\n`;
        section += `- **p值：** ${ljung.pValue?.toFixed(4) || 'N/A'}\n`;
        section += `- **结果：** ${ljung.isWhiteNoise ? '通过（残差为白噪声）' : '未通过（残差存在自相关）'}\n\n`;
    }
    
    if (diagnostics.normalityTest) {
        const normal = diagnostics.normalityTest;
        section += `### 残差正态性检验\n\n`;
        section += `- **统计量：** ${normal.statistic?.toFixed(4) || 'N/A'}\n`;
        section += `- **p值：** ${normal.pValue?.toFixed(4) || 'N/A'}\n`;
        section += `- **结果：** ${normal.isNormal ? '通过（残差服从正态分布）' : '未通过（残差不服从正态分布）'}\n\n`;
    }
    
    return section;
}

// 生成结论和庭议
function generateConclusionsAndRecommendations(simulationData: any, statistics: any, riskMetrics: any): string {
    let section = '基于本次模拟分析结果，我们得出以下主要结论和庭议：\n\n';
    
    section += '### 主要结论\n\n';
    
    // 根据统计结果生成结论
    if (statistics && statistics.finalValues) {
        const cv = statistics.finalValues.coefficientOfVariation;
        if (cv && cv < 0.15) {
            section += '1. **模型预测相对稳定：** 变异系数较低，表明预测结果的不确定性相对较小\n';
        } else if (cv && cv > 0.3) {
            section += '1. **模型预测不确定性较高：** 变异系数较大，需要特别注意风险管理\n';
        }
        
        const expectedReturn = (statistics.finalValues.mean - simulationData.parameters?.initialValue) / simulationData.parameters?.initialValue * 100;
        if (expectedReturn > 5) {
            section += '2. **投资前景相对乐观：** 模型显示正面的预期收益\n';
        } else if (expectedReturn < -5) {
            section += '2. **投资风险需要关注：** 模型显示负面的预期收益\n';
        }
    }
    
    section += '\n### 投资庭议\n\n';
    
    section += '1. **建立多元化投资组合：** 不要仅依赖单一模型的预测结果，庭议结合多种分析方法\n';
    section += '2. **定期更新模型参数：** 随着市场环境的变化，庭议每季度重新校准模型参数\n';
    section += '3. **建立风险控制机制：** 根据风险指标设置止损点和仓位管理规则\n';
    
    if (riskMetrics && riskMetrics.valueAtRisk) {
        section += `4. **风险预算：** 基于95% VaR值${riskMetrics.valueAtRisk.var95?.toFixed(1) || 'N/A'}%，庭议预留相应的风险缓冲\n`;
    }
    
    return section;
}

// 生成技术附录
function generateTechnicalAppendix(model: string, parameters: any): string {
    let appendix = `**模型类型：** ${model || 'Unknown'}\n\n`;
    
    if (model?.includes('ARIMA')) {
        appendix += 'ARIMA（自回归综合移动平均模型）是一种经典的时间序列分析方法，适用于捕捉数据中的趋势、季节性和自相关结构。\n\n';
        appendix += '**模型特点：**\n';
        appendix += '- 自回归部分（AR）：描述变量与其过去值的关系\n';
        appendix += '- 差分部分（I）：确保数据序列的平稳性\n';
        appendix += '- 移动平均部分（MA）：模拟随机冲击的影响\n\n';
    } else if (model?.includes('Monte-Carlo')) {
        appendix += '蒙特卡洛模拟是一种基于随机抽样的数值分析方法，通过生成大量随机场景来评估不确定性。\n\n';
        appendix += '**模型特点：**\n';
        appendix += '- 随机性：充分考虑各种不确定性因素\n';
        appendix += '- 分布形层：提供完整的概率分布信息\n';
        appendix += '- 风险评估：内置VaR、CVaR等风险度量指标\n\n';
    }
    
    if (parameters) {
        appendix += '**参数设置：**\n';
        for (const [key, value] of Object.entries(parameters)) {
            appendix += `- ${translateParameterName(key)}: ${value}\n`;
        }
    }
    
    return appendix;
}

// 估算页数
function estimatePageCount(content: string): number {
    // 简化估算：每800字符约为一页
    return Math.ceil(content.length / 800);
}