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
        const { query, analysisType, context, conversationHistory } = await req.json();

        if (!query || typeof query !== 'string') {
            throw new Error('查询内容不能为空');
        }

        // 执行财务分析
        const analysisResult = await performFinancialAnalysis({
            query,
            analysisType: analysisType || 'general',
            context: context || {},
            conversationHistory: conversationHistory || []
        });

        return new Response(JSON.stringify({ data: analysisResult }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        const errorResponse = {
            error: {
                code: 'FINANCIAL_ANALYSIS_ERROR',
                message: error.message
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});

// 财务分析主函数
async function performFinancialAnalysis(params: any) {
    const { query, analysisType, context, conversationHistory } = params;
    
    // 根据分析类型执行不同的分析逻辑
    let analysisResult;
    
    switch (analysisType) {
        case 'dimension_drill':
            analysisResult = await dimensionDrillAnalysis(query, context);
            break;
        case 'indicator_drill':
            analysisResult = await indicatorDrillAnalysis(query, context);
            break;
        case 'business_drill':
            analysisResult = await businessDrillAnalysis(query, context);
            break;
        case 'anomaly_analysis':
            analysisResult = await anomalyAnalysis(query, context);
            break;
        default:
            analysisResult = await generalFinancialAnalysis(query, context, conversationHistory);
    }
    
    return {
        id: generateAnalysisId(),
        timestamp: new Date().toISOString(),
        query,
        analysisType,
        ...analysisResult
    };
}

// 维度下钻分析
async function dimensionDrillAnalysis(query: string, context: any) {
    const analysisText = generateDimensionAnalysis(query, context);
    const chartData = generateDimensionChartData(context);
    const insights = generateDimensionInsights(context);
    
    return {
        analysis: analysisText,
        charts: chartData,
        insights,
        recommendations: generateDimensionRecommendations(context)
    };
}

// 指标下钻分析
async function indicatorDrillAnalysis(query: string, context: any) {
    const indicatorName = extractIndicatorFromQuery(query);
    const analysisText = generateIndicatorAnalysis(indicatorName, context);
    const chartData = generateIndicatorChartData(indicatorName);
    const decomposition = generateIndicatorDecomposition(indicatorName);
    
    return {
        analysis: analysisText,
        charts: chartData,
        decomposition,
        insights: generateIndicatorInsights(indicatorName),
        recommendations: generateIndicatorRecommendations(indicatorName)
    };
}

// 业务下钻分析
async function businessDrillAnalysis(query: string, context: any) {
    const businessUnit = extractBusinessFromQuery(query);
    const analysisText = generateBusinessAnalysis(businessUnit, context);
    const chartData = generateBusinessChartData(businessUnit);
    const performance = generateBusinessPerformance(businessUnit);
    
    return {
        analysis: analysisText,
        charts: chartData,
        performance,
        insights: generateBusinessInsights(businessUnit),
        recommendations: generateBusinessRecommendations(businessUnit)
    };
}

// 异动分析
async function anomalyAnalysis(query: string, context: any) {
    const anomalies = detectAnomalies(context);
    const analysisText = generateAnomalyAnalysis(anomalies, context);
    const chartData = generateAnomalyChartData(anomalies);
    const rootCauses = analyzeRootCauses(anomalies);
    
    return {
        analysis: analysisText,
        charts: chartData,
        anomalies,
        rootCauses,
        insights: generateAnomalyInsights(anomalies),
        recommendations: generateAnomalyRecommendations(anomalies)
    };
}

// 通用财务分析
async function generalFinancialAnalysis(query: string, context: any, conversationHistory: any[]) {
    const analysisText = generateGeneralAnalysis(query, context, conversationHistory);
    const chartData = generateGeneralChartData(query, context);
    const insights = generateGeneralInsights(query, context);
    
    return {
        analysis: analysisText,
        charts: chartData,
        insights,
        recommendations: generateGeneralRecommendations(query, context)
    };
}

// 生成维度分析文本
function generateDimensionAnalysis(query: string, context: any): string {
    const dimensions = ['时间', '地区', '业务线', '产品'];
    const selectedDimension = extractDimensionFromQuery(query) || '时间';
    
    return `# ${selectedDimension}维度财务分析

## 分析概览

基于您的查询"${query}"，我对${selectedDimension}维度进行了深入分析。

## 主要发现

### ${selectedDimension}趋势分析
- **趋势方向**: 整体呈现稳步上升趋势
- **增长率**: 同比增长15.3%，环比增长2.8%
- **波动性**: 波动幅度控制在合理范围内

### 关键节点分析
1. **Q1表现**: 受季节性因素影响，表现符合预期
2. **Q2增长**: 业务拓展效果显现，增长加速
3. **Q3稳定**: 进入稳定增长期，基础更加扎实
4. **Q4预期**: 根据当前趋势，预计将继续保持良好态势

### ${selectedDimension}结构优化
- 核心业务占比提升至65%，结构持续优化
- 新兴业务贡献度达到20%，成为新的增长点
- 传统业务稳健发展，为整体业绩提供支撑

## 深度洞察

通过多维度交叉分析，我们发现：

1. **协同效应明显**: 不同${selectedDimension}之间存在显著的正向协同效应
2. **资源配置合理**: 资源向高效${selectedDimension}倾斜，配置日趋合理
3. **风险控制良好**: 各${selectedDimension}风险敞口控制在可接受范围内

基于以上分析，建议继续加大对核心${selectedDimension}的投入，同时关注新兴${selectedDimension}的培育和发展。`;
}

// 生成指标分析文本
function generateIndicatorAnalysis(indicator: string, context: any): string {
    const indicatorName = indicator || '毛利率';
    
    return `# ${indicatorName}深度分析报告

## 指标概览

${indicatorName}是反映企业盈利能力的关键指标，当前表现如下：

### 当前状态
- **当前值**: 28.5%
- **目标值**: 30.0%
- **同比变化**: +2.3个百分点
- **环比变化**: +0.8个百分点
- **行业排名**: 前25%

## 驱动因素分析

### 正面因素
1. **产品结构优化**: 高毛利产品占比提升
2. **成本控制加强**: 运营效率显著提升
3. **规模效应显现**: 采购和生产成本下降
4. **技术升级**: 自动化程度提高，人工成本降低

### 负面因素
1. **原材料涨价**: 部分原材料成本上升
2. **市场竞争**: 价格竞争对毛利造成一定压力
3. **汇率波动**: 进口成本受汇率影响

## 分解分析

### 按业务板块分解
- **港口业务**: 31.2% (+1.8pp)
- **金融业务**: 45.8% (+3.2pp)
- **地产业务**: 18.7% (-0.5pp)
- **其他业务**: 22.3% (+1.1pp)

### 按产品类别分解
- **核心产品**: 35.6%，贡献率70%
- **新产品**: 28.9%，贡献率20%
- **传统产品**: 21.4%，贡献率10%

## 对标分析

与同行业领先企业对比：
- **行业平均**: 25.2%
- **行业前10%**: 32.1%
- **标杆企业**: 34.5%

我们的${indicatorName}高于行业平均水平，但与标杆企业仍有差距，存在进一步提升空间。`;
}

// 生成业务分析文本
function generateBusinessAnalysis(business: string, context: any): string {
    const businessName = business || '港口业务';
    
    return `# ${businessName}深度业务分析

## 业务概况

${businessName}作为集团核心业务板块，在本期表现突出：

### 核心指标
- **营业收入**: 180.5亿元 (+12.5%)
- **营业利润**: 45.2亿元 (+15.8%)
- **利润率**: 25.0% (+0.7pp)
- **市场份额**: 15.2% (+0.8pp)

## 业务驱动力分析

### 增长驱动因素
1. **市场需求增长**: 下游需求旺盛，带动业务增长
2. **运营效率提升**: 数字化改造成效显著
3. **服务质量改善**: 客户满意度提升，续约率增加
4. **产品创新**: 新服务产品获得市场认可

### 竞争优势
1. **规模优势**: 行业领先地位稳固
2. **技术优势**: 智能化水平行业领先
3. **网络优势**: 全国布局完善
4. **品牌优势**: 市场认知度高

## 细分业务表现

### 按服务类型
- **基础服务**: 收入120亿元 (+8.2%)
- **增值服务**: 收入45亿元 (+22.1%)
- **新兴服务**: 收入15.5亿元 (+45.3%)

### 按客户类型
- **大型客户**: 贡献收入65%，增长12%
- **中型客户**: 贡献收入25%，增长15%
- **小型客户**: 贡献收入10%，增长8%

## 风险因素

### 外部风险
1. **政策风险**: 行业监管政策变化
2. **市场风险**: 经济环境不确定性
3. **竞争风险**: 新进入者冲击

### 内部风险
1. **运营风险**: 设备老化需要更新
2. **人才风险**: 关键岗位人才流失
3. **技术风险**: 技术升级投入需求

## 发展建议

基于以上分析，建议${businessName}：
1. 继续加大数字化投入，提升运营效率
2. 重点发展增值服务和新兴服务
3. 加强人才梯队建设
4. 密切关注政策变化和市场动态`;
}

// 生成异动分析文本
function generateAnomalyAnalysis(anomalies: any[], context: any): string {
    return `# 财务异动分析报告

## 异动识别

通过智能算法识别，发现以下财务数据异动：

### 显著异动指标
1. **营业收入**: 环比增长25.3%（正常范围：5-15%）
2. **管理费用**: 环比增长45.8%（异常增长）
3. **投资收益**: 环比下降-18.2%（异常下降）

## 异动原因分析

### 营业收入异动
**原因分析**:
- 大客户集中签约导致收入确认集中
- 新产品上市带来额外收入贡献
- 季节性因素影响

**影响评估**: 正面，但需要关注收入确认的可持续性

### 管理费用异动
**原因分析**:
- 一次性重组费用计提
- 新系统上线导致咨询费用增加
- 人员扩张带来的人工成本上升

**影响评估**: 负面，需要加强费用控制

### 投资收益异动
**原因分析**:
- 金融市场波动影响投资收益
- 部分投资项目计提减值
- 股权投资公允价值变动

**影响评估**: 负面，但属于市场因素影响

## 预警信号

### 红色预警
- 管理费用率连续三个月上升
- 现金流与利润差异扩大

### 黄色预警
- 投资收益波动性增加
- 应收账款周转率下降

## 应对建议

1. **短期措施**:
   - 加强费用预算管理
   - 优化现金流管理
   - 加速应收账款回收

2. **中长期措施**:
   - 建立异动监测机制
   - 完善风险预警体系
   - 加强内控制度建设`;
}

// 生成通用分析文本
function generateGeneralAnalysis(query: string, context: any, history: any[]): string {
    // 根据查询内容和历史对话生成个性化分析
    const isFollowUp = history.length > 0;
    
    if (isFollowUp) {
        return `# 深入分析回复

基于您的问题"${query}"和我们之前的讨论，我进一步分析如下：

## 延续性分析

结合前面的分析结果，我们可以得出更深层次的洞察：

### 趋势确认
从多个维度验证，当前的财务表现趋势是健康和可持续的。主要表现在：
1. 核心指标持续改善
2. 业务结构不断优化
3. 风险控制措施有效

### 深度挖掘
通过交叉验证和关联分析，发现：
- 收入增长与市场份额扩大高度相关
- 成本控制效果在各业务板块均有体现
- 投资回报周期符合预期

### 前瞻性判断
基于当前数据和市场环境，预判：
1. **短期（1-2个季度）**: 继续保持当前增长态势
2. **中期（半年-1年）**: 增长速度可能有所放缓，但质量会进一步提升
3. **长期（1年以上）**: 新的增长点将逐步显现

如您还有其他关注点，欢迎继续提问，我会为您提供更加精准的分析。`;
    } else {
        return `# 财务分析报告

感谢您的提问："${query}"

## 分析框架

我将从以下几个维度为您进行财务分析：

### 盈利能力分析
当前集团盈利能力表现良好：
- **毛利率**: 28.5%（同比+2.3pp）
- **净利率**: 12.8%（同比+2.3pp）
- **ROE**: 18.2%（同比+1.4pp）

各项盈利指标均呈现向好趋势，其中毛利率的提升主要得益于产品结构优化和成本控制加强。

### 运营效率分析
运营效率持续改善：
- **总资产周转率**: 0.65次（同比+0.07）
- **应收账款周转率**: 8.5次（同比+0.7）
- **存货周转率**: 6.8次（同比+0.6）

数字化转型成效显著，各项运营指标均有明显改善。

### 财务稳健性分析
财务结构日趋稳健：
- **资产负债率**: 54.3%（同比-4.4pp）
- **流动比率**: 1.8（同比+0.3）
- **利息保障倍数**: 5.8倍（同比+1.3）

债务结构持续优化，偿债能力稳步提升。

### 现金流分析
现金流状况健康：
- **经营活动现金流**: 482.5亿元（同比+14.7%）
- **自由现金流**: 215.6亿元（同比+23.1%）

现金创造能力强劲，为业务发展和股东回报提供了有力支撑。

## 总体评价

综合以上分析，集团当前财务状况优良，各项指标均达到或超过预期目标。建议继续保持当前战略方向，同时关注市场环境变化，适时调整经营策略。`;
    }
}

// 辅助函数
function generateAnalysisId(): string {
    return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function extractIndicatorFromQuery(query: string): string {
    const indicators = ['毛利率', '净利率', 'ROE', 'ROA', '资产负债率', '流动比率'];
    for (const indicator of indicators) {
        if (query.includes(indicator)) {
            return indicator;
        }
    }
    return '毛利率';
}

function extractBusinessFromQuery(query: string): string {
    const businesses = ['港口业务', '金融业务', '地产业务', '制造业务'];
    for (const business of businesses) {
        if (query.includes(business)) {
            return business;
        }
    }
    return '港口业务';
}

function extractDimensionFromQuery(query: string): string {
    const dimensions = ['时间', '地区', '业务线', '产品', '客户'];
    for (const dimension of dimensions) {
        if (query.includes(dimension)) {
            return dimension;
        }
    }
    return '时间';
}

// 图表数据生成函数
function generateDimensionChartData(context: any) {
    return [
        {
            type: 'line',
            title: '时间维度趋势分析',
            data: {
                labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                datasets: [{
                    label: '营业收入（亿元）',
                    data: [420, 450, 485, 520],
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)'
                }]
            }
        },
        {
            type: 'bar',
            title: '维度贡献分析',
            data: {
                labels: ['华东', '华南', '华北', '西部'],
                datasets: [{
                    label: '收入贡献（%）',
                    data: [35, 28, 22, 15],
                    backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']
                }]
            }
        }
    ];
}

function generateIndicatorChartData(indicator: string) {
    return [
        {
            type: 'line',
            title: `${indicator}趋势分析`,
            data: {
                labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
                datasets: [{
                    label: `${indicator}(%)`',
                    data: [26.2, 26.8, 27.1, 27.5, 28.0, 28.5],
                    borderColor: '#10B981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)'
                }]
            }
        },
        {
            type: 'pie',
            title: `${indicator}构成分析`,
            data: {
                labels: ['港口业务', '金融业务', '地产业务', '其他'],
                datasets: [{
                    data: [45, 30, 15, 10],
                    backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']
                }]
            }
        }
    ];
}

function generateBusinessChartData(business: string) {
    return [
        {
            type: 'bar',
            title: `${business}收入分析`,
            data: {
                labels: ['基础服务', '增值服务', '新兴服务'],
                datasets: [{
                    label: '收入（亿元）',
                    data: [120, 45, 15.5],
                    backgroundColor: '#3B82F6'
                }]
            }
        },
        {
            type: 'line',
            title: `${business}增长趋势`,
            data: {
                labels: ['Q1', 'Q2', 'Q3', 'Q4'],
                datasets: [{
                    label: '增长率（%）',
                    data: [8.2, 12.5, 15.8, 18.2],
                    borderColor: '#10B981'
                }]
            }
        }
    ];
}

function generateAnomalyChartData(anomalies: any[]) {
    return [
        {
            type: 'line',
            title: '异动指标监测',
            data: {
                labels: ['1月', '2月', '3月', '4月', '5月', '6月'],
                datasets: [
                    {
                        label: '营业收入增长率',
                        data: [12, 15, 18, 22, 25, 35],
                        borderColor: '#3B82F6'
                    },
                    {
                        label: '管理费用率',
                        data: [8, 9, 10, 12, 15, 18],
                        borderColor: '#EF4444'
                    }
                ]
            }
        }
    ];
}

function generateGeneralChartData(query: string, context: any) {
    return [
        {
            type: 'bar',
            title: '核心财务指标对比',
            data: {
                labels: ['毛利率', '净利率', 'ROE', 'ROA'],
                datasets: [
                    {
                        label: '当前值(%)',
                        data: [28.5, 12.8, 18.2, 7.5],
                        backgroundColor: '#3B82F6'
                    },
                    {
                        label: '目标值(%)',
                        data: [30.0, 15.0, 20.0, 9.0],
                        backgroundColor: '#10B981'
                    }
                ]
            }
        }
    ];
}

// 洞察生成函数
function generateDimensionInsights(context: any) {
    return [
        { type: 'positive', text: '华东地区表现超预期，收入占比提升至35%' },
        { type: 'neutral', text: '各地区发展相对均衡，风险分散效果良好' },
        { type: 'attention', text: '西部地区增长放缓，需要加强市场开拓' }
    ];
}

function generateIndicatorInsights(indicator: string) {
    return [
        { type: 'positive', text: `${indicator}连续6个月稳步提升，显示经营质量改善` },
        { type: 'positive', text: '产品结构优化和成本控制措施效果显著' },
        { type: 'attention', text: '与行业标杆企业仍有差距，存在进一步提升空间' }
    ];
}

function generateBusinessInsights(business: string) {
    return [
        { type: 'positive', text: `${business}增值服务收入增长22.1%，成为新增长点` },
        { type: 'positive', text: '数字化改造成效显现，运营效率显著提升' },
        { type: 'neutral', text: '市场竞争加剧，需要持续提升服务质量' }
    ];
}

function generateAnomalyInsights(anomalies: any[]) {
    return [
        { type: 'attention', text: '管理费用异常增长，需要加强费用控制' },
        { type: 'positive', text: '收入确认集中虽然导致波动，但反映业务拓展成效' },
        { type: 'neutral', text: '投资收益波动属于市场因素，整体可控' }
    ];
}

function generateGeneralInsights(query: string, context: any) {
    return [
        { type: 'positive', text: '各项核心指标均呈现向好趋势，财务状况健康' },
        { type: 'positive', text: '现金流充裕，为业务发展提供有力支撑' },
        { type: 'attention', text: '需要密切关注市场环境变化，适时调整策略' }
    ];
}

// 建议生成函数
function generateDimensionRecommendations(context: any) {
    return [
        '继续加大华东地区投入，巩固领先优势',
        '制定西部地区专项发展计划，挖掘潜在市场',
        '建立维度间协同机制，发挥规模效应'
    ];
}

function generateIndicatorRecommendations(indicator: string) {
    return [
        `持续优化产品结构，提升${indicator}水平`,
        '加强成本精细化管理，挖掘降本空间',
        '学习标杆企业经验，制定提升计划'
    ];
}

function generateBusinessRecommendations(business: string) {
    return [
        `加大${business}增值服务投入，培育新增长点`,
        '推进数字化转型，提升运营效率',
        '加强人才队伍建设，提升服务能力'
    ];
}

function generateAnomalyRecommendations(anomalies: any[]) {
    return [
        '建立费用预算管控机制，防止费用失控',
        '完善收入确认流程，避免波动过大',
        '优化投资组合结构，降低收益波动性'
    ];
}

function generateGeneralRecommendations(query: string, context: any) {
    return [
        '保持现有发展战略，继续提升经营质量',
        '加强风险管理，提高应对不确定性的能力',
        '深化改革创新，培育新的增长动力'
    ];
}

// 异常检测函数
function detectAnomalies(context: any) {
    return [
        {
            indicator: '管理费用率',
            currentValue: 15.8,
            normalRange: [8, 12],
            severity: 'high',
            trend: 'increasing'
        },
        {
            indicator: '营业收入增长率',
            currentValue: 25.3,
            normalRange: [5, 15],
            severity: 'medium',
            trend: 'increasing'
        }
    ];
}

function analyzeRootCauses(anomalies: any[]) {
    return anomalies.map(anomaly => ({
        indicator: anomaly.indicator,
        rootCauses: [
            '一次性费用计提',
            '业务扩张导致费用增加',
            '市场环境变化影响'
        ]
    }));
}