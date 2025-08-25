import React from 'react';

// 简单的图表模拟组件，在实际项目中，你可能使用如Chart.js、Recharts等库

interface ChartData {
  labels: string[];
  datasets: {
    data: number[];
    backgroundColor?: string[] | string;
    borderColor?: string;
  }[];
}

interface ChartProps {
  data: ChartData;
  height?: number;
}

// 折线图组件
export const LineChart: React.FC<ChartProps> = ({ data, height = 300 }) => {
  return (
    <div style={{ height: height, padding: '10px', textAlign: 'center' }}>
      <div style={{ color: '#555', marginBottom: '10px' }}>折线图（模拟）</div>
      <div style={{ 
        display: 'flex', 
        height: '200px', 
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        borderBottom: '1px solid #ddd',
        position: 'relative'
      }}>
        {data.labels.map((label, index) => {
          const value = data.datasets[0].data[index];
          const maxValue = Math.max(...data.datasets[0].data);
          const height = (value / maxValue) * 180;
          
          return (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${100 / data.labels.length}%` }}>
              <div style={{ 
                height: `${height}px`, 
                width: '10px', 
                backgroundColor: data.datasets[0].borderColor || '#3B82F6',
                marginBottom: '5px',
                position: 'relative'
              }}>
                <span style={{ position: 'absolute', top: '-20px', fontSize: '12px', color: '#555' }}>{value}</span>
              </div>
              <div style={{ fontSize: '10px', transform: 'rotate(-45deg)', transformOrigin: 'left top', marginTop: '10px' }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 柱状图组件
export const BarChart: React.FC<ChartProps> = ({ data, height = 300 }) => {
  return (
    <div style={{ height: height, padding: '10px', textAlign: 'center' }}>
      <div style={{ color: '#555', marginBottom: '10px' }}>柱状图（模拟）</div>
      <div style={{ 
        display: 'flex', 
        height: '200px', 
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        borderBottom: '1px solid #ddd'
      }}>
        {data.labels.map((label, index) => {
          const value = data.datasets[0].data[index];
          const maxValue = Math.max(...data.datasets[0].data);
          const height = (value / maxValue) * 180;
          const bgColor = Array.isArray(data.datasets[0].backgroundColor) 
            ? data.datasets[0].backgroundColor[index] 
            : data.datasets[0].backgroundColor || '#3B82F6';
          
          return (
            <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${100 / data.labels.length}%` }}>
              <div style={{ 
                height: `${height}px`, 
                width: '30px', 
                backgroundColor: bgColor,
                marginBottom: '5px',
                position: 'relative'
              }}>
                <span style={{ position: 'absolute', top: '-20px', fontSize: '12px', color: '#555' }}>{value}</span>
              </div>
              <div style={{ fontSize: '10px', transform: 'rotate(-45deg)', transformOrigin: 'left top', marginTop: '10px' }}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 饼图组件
export const PieChart: React.FC<ChartProps> = ({ data, height = 300 }) => {
  return (
    <div style={{ height: height, padding: '10px', textAlign: 'center' }}>
      <div style={{ color: '#555', marginBottom: '10px' }}>饼图（模拟）</div>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginTop: '20px'
      }}>
        {data.labels.map((label, index) => {
          const value = data.datasets[0].data[index];
          const totalValue = data.datasets[0].data.reduce((a, b) => a + b, 0);
          const percentage = Math.round((value / totalValue) * 100);
          const bgColor = Array.isArray(data.datasets[0].backgroundColor) 
            ? data.datasets[0].backgroundColor[index] 
            : data.datasets[0].backgroundColor || '#3B82F6';
          
          return (
            <div key={index} style={{ display: 'flex', alignItems: 'center', margin: '5px 10px' }}>
              <div style={{ 
                width: '15px', 
                height: '15px', 
                backgroundColor: bgColor,
                marginRight: '5px'
              }}></div>
              <div style={{ fontSize: '12px' }}>{label}: {percentage}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
