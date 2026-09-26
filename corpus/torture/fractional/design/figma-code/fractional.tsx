const assetPathPrefix = "https://www.figma.com/api/mcp/asset/ad85e736-4c27-4192-b9c7-b18ab8f6a899";
const imgHome2015 = `${assetPathPrefix}/66960.svg`;
const imgHome2415 = `${assetPathPrefix}/c79fa.svg`;
const imgHome241 = `${assetPathPrefix}/6b23f.svg`;
const imgHome242 = `${assetPathPrefix}/91236.svg`;

export default function TFractional() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative size-full" data-node-id="2:98" data-name="t-fractional">
      <div className="bg-[#f2f4f7] content-stretch flex flex-col items-start overflow-clip px-[20px] py-[14.25px] relative shrink-0 w-full" data-node-id="2:99" data-name="half-band">
        <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#101828] text-[15px] whitespace-nowrap" data-node-id="2:100">
          Band of 48.5 px
        </p>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip pb-[10px] pl-[20.5px] pr-[20px] pt-[10.5px] relative shrink-0 w-full" data-node-id="2:101" data-name="half-box">
        <div className="bg-[#7f56d9] h-[40.5px] relative rounded-[6px] shrink-0 w-[100.5px]" data-node-id="2:102" data-name="Rectangle" />
      </div>
      <div className="content-stretch flex flex-col gap-[12px] items-start overflow-clip px-[20px] py-[12px] relative shrink-0 w-full" data-node-id="2:103" data-name="hairline">
        <div className="bg-[#98a2b3] h-[0.5px] relative shrink-0 w-[335px]" data-node-id="2:104" data-name="Rectangle" />
        <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[20px] not-italic relative shrink-0 text-[#475467] text-[15px] whitespace-nowrap" data-node-id="2:105">
          Under a 0.5 px hairline
        </p>
      </div>
      <div className="content-stretch flex flex-col items-start overflow-clip px-[20px] py-[12px] relative shrink-0 w-full" data-node-id="2:106" data-name="odd-line-height">
        <p className="[word-break:break-word] font-['Inter:Regular'] font-normal leading-[21.5px] not-italic relative shrink-0 text-[#101828] text-[15px] w-full" data-node-id="2:107">
          Two lines of text with a line height of 21.5 px, which rounds differently in every engine.
        </p>
      </div>
      <div className="content-stretch flex gap-[20px] items-center overflow-clip px-[20px] py-[16px] relative shrink-0 w-full" data-node-id="2:108" data-name="icon-strokes">
        <div className="relative shrink-0 size-[20px]" data-node-id="2:109" data-name="home-20-1.5">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgHome2015} />
        </div>
        <div className="relative shrink-0 size-[24px]" data-node-id="2:111" data-name="home-24-1.5">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgHome2415} />
        </div>
        <div className="relative shrink-0 size-[24px]" data-node-id="2:113" data-name="home-24-1">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgHome241} />
        </div>
        <div className="relative shrink-0 size-[24px]" data-node-id="2:115" data-name="home-24-2">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgHome242} />
        </div>
      </div>
      <div className="[word-break:break-word] content-stretch flex gap-[12px] items-start not-italic overflow-clip px-[20px] py-[16px] relative shrink-0 w-full whitespace-nowrap" data-node-id="2:117" data-name="half-grid">
        <div className="bg-[#f9fafb] border border-[#eaecf0] border-solid content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px overflow-clip px-[16px] py-[14px] relative rounded-[12px]" data-node-id="2:118" data-name="card">
          <p className="font-['Inter:Regular'] font-normal leading-[18px] relative shrink-0 text-[#667085] text-[13px]" data-node-id="2:119">
            Income
          </p>
          <p className="font-['Inter:Semi_Bold'] font-semibold leading-[28px] relative shrink-0 text-[#101828] text-[20px]" data-node-id="2:120">
            $4,280.50
          </p>
        </div>
        <div className="bg-[#f9fafb] border border-[#eaecf0] border-solid content-stretch flex flex-[1_0_0] flex-col gap-[4px] items-start min-w-px overflow-clip px-[16px] py-[14px] relative rounded-[12px]" data-node-id="2:121" data-name="card">
          <p className="font-['Inter:Regular'] font-normal leading-[18px] relative shrink-0 text-[#667085] text-[13px]" data-node-id="2:122">
            Expenses
          </p>
          <p className="font-['Inter:Semi_Bold'] font-semibold leading-[28px] relative shrink-0 text-[#101828] text-[20px]" data-node-id="2:123">
            $1,932.17
          </p>
        </div>
      </div>
    </div>
  );
}
