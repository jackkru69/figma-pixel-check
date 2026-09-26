const assetPathPrefix = "https://www.figma.com/api/mcp/asset/dd506f72-6157-4cd8-9b70-15acc0abd39a";
const imgMask = `${assetPathPrefix}/d3f86.svg`;

export default function TRadii() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative size-full" data-node-id="2:124" data-name="t-radii">
      <div className="content-stretch flex gap-[12px] items-center overflow-clip px-[20px] py-[16px] relative shrink-0 w-full" data-node-id="2:125" data-name="radius-scale">
        <div className="bg-[#d6bbfb] relative rounded-[4px] shrink-0 size-[56px]" data-node-id="2:126" data-name="Rectangle" />
        <div className="bg-[#d6bbfb] relative rounded-[8px] shrink-0 size-[56px]" data-node-id="2:127" data-name="Rectangle" />
        <div className="bg-[#d6bbfb] relative rounded-[16px] shrink-0 size-[56px]" data-node-id="2:128" data-name="Rectangle" />
        <div className="bg-[#d6bbfb] relative rounded-[28px] shrink-0 size-[56px]" data-node-id="2:129" data-name="Rectangle" />
        <div className="bg-[#f4ebff] content-stretch flex items-start overflow-clip px-[12px] py-[6px] relative rounded-[999px] shrink-0" data-node-id="2:130" data-name="pill">
          <p className="[word-break:break-word] font-['Inter:Medium'] font-medium leading-[20px] not-italic relative shrink-0 text-[#6941c6] text-[14px] whitespace-nowrap" data-node-id="2:131">
            Pill
          </p>
        </div>
      </div>
      <div className="bg-[#667085] content-stretch flex flex-col items-center overflow-clip pt-[24px] relative shrink-0 w-full" data-node-id="2:132" data-name="sheet-top">
        <div className="bg-white content-stretch flex flex-col gap-[16px] items-center overflow-clip pb-[20px] pt-[8px] px-[20px] relative rounded-tl-[24px] rounded-tr-[24px] shrink-0 w-full" data-node-id="2:133" data-name="sheet">
          <div className="bg-[#d0d5dd] h-[5px] relative rounded-[2.5px] shrink-0 w-[36px]" data-node-id="2:134" data-name="Rectangle" />
          <p className="[word-break:break-word] font-['Inter:Semi_Bold'] font-semibold leading-[22px] not-italic relative shrink-0 text-[#101828] text-[17px] whitespace-nowrap" data-node-id="2:135">
            Bottom sheet with top radius 24
          </p>
        </div>
      </div>
      <div className="content-stretch flex gap-[24px] items-center overflow-clip px-[20px] py-[16px] relative shrink-0 w-full" data-node-id="2:136" data-name="smoothing">
        <div className="bg-[#101828] relative rounded-[24px] shrink-0 size-[96px]" data-node-id="2:137" data-name="smoothing-0" />
        <div className="bg-[#101828] relative rounded-[24px] shrink-0 size-[96px]" data-node-id="2:138" data-name="smoothing-0.6" />
      </div>
      <div className="content-stretch flex flex-col items-center overflow-clip px-[20px] py-[16px] relative shrink-0 w-full" data-node-id="2:139" data-name="clip">
        <div className="h-[120px] relative shrink-0 w-[335px]" data-node-id="2:140" data-name="mask">
          <img alt="" className="absolute block inset-0 max-w-none size-full" src={imgMask} />
        </div>
      </div>
    </div>
  );
}
