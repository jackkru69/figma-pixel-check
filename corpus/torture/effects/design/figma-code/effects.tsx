const assetPathPrefix = "https://www.figma.com/api/mcp/asset/5349bafb-b975-4f15-8521-fb79257ef180";
const imgRow = `${assetPathPrefix}/302a6.svg`;
const imgEllipse = `${assetPathPrefix}/eadca.svg`;

export default function TEffects() {
  return (
    <div className="bg-[#f9fafb] content-stretch flex flex-col items-start relative size-full" data-node-id="2:55" data-name="t-effects">
      <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] py-[24px] relative shrink-0 w-full" data-node-id="2:56" data-name="shadow-sm">
        <div className="bg-white content-stretch flex h-[72px] items-center overflow-clip px-[20px] relative rounded-[12px] shadow-[0px_1px_2px_0px_rgba(16,24,40,0.06),0px_1px_3px_0px_rgba(16,24,40,0.1)] shrink-0 w-[335px]" data-node-id="2:57" data-name="card">
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#101828] text-[15px] whitespace-nowrap" data-node-id="2:58">
            Shadow sm · 0 1 3 / 0 1 2
          </p>
        </div>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] py-[24px] relative shrink-0 w-full" data-node-id="2:59" data-name="shadow-lg">
        <div className="bg-white content-stretch flex h-[72px] items-center overflow-clip px-[20px] relative rounded-[12px] shadow-[0px_4px_6px_-2px_rgba(16,24,40,0.03),0px_12px_16px_-4px_rgba(16,24,40,0.08)] shrink-0 w-[335px]" data-node-id="2:60" data-name="card">
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#101828] text-[15px] whitespace-nowrap" data-node-id="2:61">
            Shadow lg · 0 12 16 −4 / 0 4 6 −2
          </p>
        </div>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] py-[24px] relative shrink-0 w-full" data-node-id="2:62" data-name="inner">
        <div className="content-stretch flex h-[72px] items-center overflow-clip px-[20px] relative rounded-[12px] shrink-0 w-[335px]" data-node-id="2:63" data-name="card">
          <div aria-hidden className="absolute bg-[#f2f4f7] inset-0 pointer-events-none rounded-[12px]" />
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#101828] text-[15px] whitespace-nowrap" data-node-id="2:64">
            Inner shadow · 0 2 4
          </p>
          <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0px_2px_4px_0px_rgba(16,24,40,0.12)]" />
        </div>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] py-[24px] relative shrink-0 w-full" data-node-id="2:65" data-name="blur">
        <div className="h-[64px] relative shrink-0 w-[240px]" data-node-id="2:66" data-name="row">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgRow} />
        </div>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] py-[24px] relative shrink-0 w-full" data-node-id="2:70" data-name="glass">
        <div className="bg-gradient-to-r from-[#7f56d9] h-[140px] overflow-clip relative rounded-[16px] shrink-0 to-[#ee46bc] w-[335px]" data-node-id="2:71" data-name="stage">
          <div className="absolute left-[200px] size-[120px] top-[-30px]" data-node-id="2:72" data-name="Ellipse">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgEllipse} />
          </div>
          <div className="absolute backdrop-blur-[6px] bg-[rgba(255,255,255,0.3)] content-stretch flex h-[72px] items-center left-[20px] overflow-clip px-[20px] rounded-[12px] top-[34px] w-[295px]" data-node-id="2:73" data-name="glass-card">
            <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[20px] not-italic relative shrink-0 text-[15px] text-white whitespace-nowrap" data-node-id="2:74">
              Glass · background blur 12
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
